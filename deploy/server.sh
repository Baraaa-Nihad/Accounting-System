#!/usr/bin/env bash
# ============================================================
# النظام المالي للمدرسة — التثبيت والإدارة على خادم Linux عبر Docker
#
# صُمم ليعمل بأمان على خادم يستضيف تطبيقات ومواقع أخرى:
#   - مشروع Docker مستقل (school-accounting): حاويات وشبكة ووحدات تخزين خاصة به
#   - قاعدة PostgreSQL خاصة بالنظام، غير منشورة على أي منفذ
#   - التطبيق على 127.0.0.1 فقط خلف خادم الويب، مع حدود للذاكرة والمعالج وتدوير للسجلات
#   - ملف موقع مستقل في Nginx أو Apache يُفحص قبل إعادة التحميل، ويُحذف فورًا إن رفضه الخادم
#   - لا يوقف ولا يعدّل أي حاوية أو موقع أو قاعدة بيانات أخرى
#
# الاستخدام (التفاصيل في deploy/README.md):
#   sudo bash server.sh check   --domain school.example.com   فحص الخادم وعرض الخطة دون أي تغيير
#   sudo bash server.sh install --domain school.example.com   تثبيت مع HTTPS
#   sudo bash server.sh install --port 8090                   بدون نطاق: http://IP-الخادم:8090
#   sudo bash server.sh update | status | info | logs | https | uninstall
#
# رسائل السكربت بالإنجليزية لأن كثيرًا من الطرفيات لا تعرض العربية بشكل صحيح.
# ============================================================

set -Eeuo pipefail

REPO_URL="${SCHOOL_REPO_URL:-https://github.com/Baraaa-Nihad/Accounting-System.git}"
DEFAULT_BRANCH="${SCHOOL_BRANCH:-claude/accounting-system-web-l8z9mu}"
BASE_DIR="${SCHOOL_BASE_DIR:-/opt/school-accounting}"
APP_DIR="$BASE_DIR/app"
CONFIG="$BASE_DIR/config.env"
CADDYFILE="$BASE_DIR/Caddyfile"
PROJECT="school-accounting"
SITE="school-accounting"
CERT_NAME="school-accounting"
ACME_ROOT="/var/www/school-accounting-acme"
# ذروة ذاكرة البناء المقاسة ≈ 1 GB؛ أقل من الحد الأدنى قد يضغط على التطبيقات الأخرى أثناء البناء
MIN_BUILD_MB=1536
REC_BUILD_MB=2560
MIN_DISK_GB=6

# ---------- الإخراج ----------
if [ -t 1 ]; then
  BOLD=$'\e[1m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  BOLD='' GREEN='' YELLOW='' RED='' RESET=''
fi
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '\n%s✘ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
trap 'printf "\n%s✘ Stopped at line %s (see the error above). Other sites and containers on this server were not modified.%s\n" "$RED" "$LINENO" "$RESET" >&2' ERR

usage() {
  cat <<'EOF'
School accounting system — install and manage it on a Linux server with Docker.

Usage: sudo bash server.sh <command> [options]

Commands:
  check       Inspect this server and show the plan (changes nothing)
  install     Install and start the system
  update      Download the latest version, rebuild and restart (data is kept)
  status      Show the containers and whether the system responds
  info        Show the address, the first admin login and the backup key
  logs [svc]  Follow the logs of app (default), db, migrate or caddy (Ctrl+C to exit)
  https       Get the HTTPS certificate (after the domain points to this server)
  uninstall   Remove the system completely (other apps and sites are not touched)

Options:
  --domain NAME     Subdomain for the system, e.g. school.example.com (recommended)
  --port N          Without a domain: publish on this port, http://SERVER-IP:N (default 8090)
  --email ADDRESS   Contact email for the Let's Encrypt certificate (optional)
  --web MODE        auto | nginx | apache | caddy | none   (default: auto-detect)
  --no-https        Serve plain HTTP only (no certificate)
  --branch NAME     Git branch to deploy
  --backup-key KEY  With install: reuse the backup encryption key of another installation
                    (needed to restore its backups here, e.g. when moving to a new server)
  --install-docker  Install Docker with the official get.docker.com script if it is missing
  --force           Continue even if free memory or disk space is low
  --keep-data       With uninstall: keep the database, the uploaded files and config.env
  --yes             Do not ask for confirmation
EOF
}

# ---------- المعاملات ----------
CMD="${1:-help}"
if [ $# -gt 0 ]; then shift; fi
ORIG_ARGS=("$@")
OPT_DOMAIN='' OPT_PORT='' OPT_EMAIL='' OPT_WEB='' OPT_HTTPS='' OPT_BRANCH='' OPT_BACKUP_KEY='' LOG_SERVICE='app'
YES=0 FORCE=0 KEEP_DATA=0 INSTALL_DOCKER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --*=*) set -- "${1%%=*}" "${1#*=}" "${@:2}"; continue ;;
    --domain|--port|--email|--web|--branch|--backup-key)
      [ $# -ge 2 ] || die "Missing value for $1"
      case "$1" in
        --domain) OPT_DOMAIN=$2 ;; --port) OPT_PORT=$2 ;; --email) OPT_EMAIL=$2 ;;
        --web) OPT_WEB=$2 ;; --branch) OPT_BRANCH=$2 ;; --backup-key) OPT_BACKUP_KEY=$2 ;;
      esac
      shift 2 ;;
    --no-https) OPT_HTTPS=0; shift ;;
    --install-docker) INSTALL_DOCKER=1; shift ;;
    --force) FORCE=1; shift ;;
    --keep-data) KEEP_DATA=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) CMD=help; shift ;;
    -*) die "Unknown option: $1 (see: bash server.sh help)" ;;
    *)
      if [ "$CMD" = logs ]; then LOG_SERVICE=$1; shift; else die "Unexpected argument: $1"; fi ;;
  esac
done
if [ "${SCHOOL_CONFIRMED:-0}" = 1 ]; then YES=1; fi

# ---------- أدوات عامة ----------
have() { command -v "$1" >/dev/null 2>&1; }
svc_active() { have systemctl && systemctl is-active --quiet "$1" 2>/dev/null; }
mem_mb() { awk -v k="$1:" '$1 == k { print int($2 / 1024) }' /proc/meminfo; }
free_gb() {
  local p=$1
  while [ ! -e "$p" ]; do p=$(dirname "$p"); done
  df -Pk "$p" | awk 'NR == 2 { print int($4 / 1048576) }'
}
rand() {
  local s=''
  while [ ${#s} -lt "$1" ]; do s+=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' || true); done
  printf '%s' "${s:0:$1}"
}
resolve_ips() { getent ahostsv4 "$1" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ' | sed 's/ $//' || true; }
server_ip() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)
  printf '%s' "${ip:-SERVER-IP}"
}

cfg_get() {
  [ -f "$CONFIG" ] || return 0
  sed -n "s/^$1=//p" "$CONFIG" | tail -n 1
}
cfg_set() {
  local tmp
  tmp=$(mktemp "$BASE_DIR/.config.XXXXXX")
  { if [ -f "$CONFIG" ]; then grep -v "^$1=" "$CONFIG" || true; fi; printf '%s=%s\n' "$1" "$2"; } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$CONFIG"
}

# المنافذ: من يستمع عليها (من ss) أو تنشرها حاوية Docker
port_listening() { ss -ltn 2>/dev/null | awk -v p="$1" 'NR > 1 { n = split($4, a, ":"); if (a[n] == p) f = 1 } END { exit !f }'; }
port_owner() {
  local lines
  lines=$(ss -ltnp 2>/dev/null | awk -v p="$1" 'NR > 1 { n = split($4, a, ":"); if (a[n] == p) print }' || true)
  printf '%s' "$lines" | grep -o 'users:(("[^"]*"' | head -n 1 | sed 's/users:(("//; s/"$//' || true
}
docker_ports() {
  if [ "${DOCKER_OK:-0}" = 1 ]; then docker ps "$@" --format '{{.Ports}}' 2>/dev/null || true; fi
}
docker_port_used() { local out; out=$(docker_ports); grep -Eq "[:.]$1->" <<<"$out"; }
our_port() { local out; out=$(docker_ports --filter "label=com.docker.compose.project=$PROJECT"); grep -Eq "[:.]$1->" <<<"$out"; }
port_used() { port_listening "$1" || docker_port_used "$1"; }

confirm() {
  if [ "$YES" = 1 ]; then return 0; fi
  local ans=''
  if ! { exec 3</dev/tty; } 2>/dev/null; then die "Cannot ask for confirmation (no terminal). Re-run with --yes."; fi
  read -r -p "$1 " ans <&3 || true
  exec 3<&-
  [[ "$ans" =~ ^([Yy]|[Yy][Ee][Ss])$ ]]
}
confirm_word() {
  if [ "$YES" = 1 ]; then return 0; fi
  local ans=''
  if ! { exec 3</dev/tty; } 2>/dev/null; then die "Cannot ask for confirmation (no terminal). Re-run with --yes."; fi
  read -r -p "$2 " ans <&3 || true
  exec 3<&-
  [ "$ans" = "$1" ]
}

take_lock() {
  local f="/run/lock/$SITE.lock"
  if [ ! -d /run/lock ]; then f="/tmp/$SITE.lock"; fi
  exec 9>"$f"
  if have flock && ! flock -n 9; then die "Another server.sh command is already running."; fi
}

require_root() { [ "$(id -u)" -eq 0 ] || die "Run it as root: sudo bash $0 $CMD ${ORIG_ARGS[*]:-}"; }
require_installed() { [ -f "$CONFIG" ] && [ -f "$APP_DIR/docker-compose.yml" ] || die "The system is not installed on this server (no $CONFIG). Use: install"; }

# أوامر Docker Compose الخاصة بالمشروع فقط
dc() {
  local files=(-f "$APP_DIR/docker-compose.yml" -f "$APP_DIR/deploy/compose.server.yml")
  if [ "${WEB:-}" = caddy ] || [ "${DC_ALL:-0}" = 1 ]; then files+=(-f "$APP_DIR/deploy/compose.caddy.yml"); fi
  CADDYFILE="$CADDYFILE" docker compose -p "$PROJECT" --project-directory "$APP_DIR" --env-file "$CONFIG" "${files[@]}" "$@"
}

# ---------- فحص الخادم ----------
gather() {
  OS_NAME=$( (. /etc/os-release && printf '%s' "${PRETTY_NAME:-$ID}") 2>/dev/null || uname -sr)
  ARCH=$(uname -m)
  CPUS=$(nproc 2>/dev/null || echo 1)
  MEM_TOTAL=$(mem_mb MemTotal)
  MEM_AVAIL=$(mem_mb MemAvailable)
  SWAP_FREE=$(mem_mb SwapFree)
  DOCKER_OK=0 DOCKER_VER='' COMPOSE_VER='' DOCKER_ROOT=/var/lib/docker OTHER_CONTAINERS=0
  if have docker && docker info >/dev/null 2>&1; then
    DOCKER_OK=1
    DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)
    COMPOSE_VER=$(docker compose version --short 2>/dev/null || true)
    DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
    OTHER_CONTAINERS=$(docker ps --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | grep -cvx "$PROJECT" || true)
  fi
  DISK_GB=$(free_gb "$DOCKER_ROOT")
  OWNER80=$(port_owner 80)
  OWNER443=$(port_owner 443)
  if [ -z "$OWNER80" ] && docker_port_used 80; then OWNER80=docker; fi
  if [ -z "$OWNER443" ] && docker_port_used 443; then OWNER443=docker; fi
  if our_port 80; then OWNER80=ours; fi
  if our_port 443; then OWNER443=ours; fi
}

detect_web() {
  if { [ -z "$OWNER80" ] || [ "$OWNER80" = ours ]; } && { [ -z "$OWNER443" ] || [ "$OWNER443" = ours ]; }; then WEB_DETECTED=caddy
  elif [[ "$OWNER80" == nginx* ]]; then WEB_DETECTED=nginx
  elif [[ "$OWNER80" == apache2* || "$OWNER80" == httpd* ]]; then WEB_DETECTED=apache
  else WEB_DETECTED=none
  fi
}

nginx_layout() {
  NGINX_FILE='' NGINX_LINK='' NGINX_V6_80=0 NGINX_V6_443=0 NGINX_DUMP='' NGINX_BROKEN=0
  have nginx || return 0
  local conf dir dump
  conf=$(nginx -V 2>&1 | sed -n 's/.*--conf-path=\([^ ]*\).*/\1/p' | head -n 1 || true)
  dir=$(dirname "${conf:-/etc/nginx/nginx.conf}")
  # إعدادات nginx الحالية لا تجتاز الفحص؟ لا نلمسها
  if ! dump=$(nginx -T 2>/dev/null); then NGINX_BROKEN=1; return 0; fi
  if [ -d "$dir/sites-available" ] && [ -d "$dir/sites-enabled" ] && grep -Eq '^[[:space:]]*include[[:space:]]+[^;]*sites-enabled/\*' <<<"$dump"; then
    NGINX_FILE="$dir/sites-available/$SITE.conf"
    NGINX_LINK="$dir/sites-enabled/$SITE.conf"
  elif [ -d "$dir/conf.d" ] && grep -Eq '^[[:space:]]*include[[:space:]]+[^;]*conf\.d/\*\.conf' <<<"$dump"; then
    NGINX_FILE="$dir/conf.d/$SITE.conf"
  fi
  if grep -Eq '^[[:space:]]*listen[[:space:]]+\[::\]:80([[:space:];]|$)' <<<"$dump"; then NGINX_V6_80=1; fi
  if grep -Eq '^[[:space:]]*listen[[:space:]]+\[::\]:443([[:space:];]|$)' <<<"$dump"; then NGINX_V6_443=1; fi
  NGINX_DUMP=$dump
}

# ملف إعدادات آخر (ليس ملفنا) يستخدم نفس النطاق؟
nginx_domain_owner() {
  awk -v own1="$NGINX_FILE" -v own2="$NGINX_LINK" -v d="$DOMAIN" '
    /^# configuration file / { f = $4; sub(/:$/, "", f); next }
    f == own1 || f == own2 { next }
    /^[[:space:]]*server_name[[:space:]]/ {
      line = $0; sub(/#.*/, "", line); gsub(/;/, " ", line)
      n = split(line, a, /[[:space:]]+/)
      for (i = 1; i <= n; i++) if (tolower(a[i]) == d) { print f; exit }
    }' <<<"$NGINX_DUMP"
}

apache_layout() {
  APACHE_FILE=''
  if have apache2ctl && have a2ensite && have a2enmod && [ -d /etc/apache2/sites-available ] && apache2ctl -t >/dev/null 2>&1; then
    APACHE_FILE="/etc/apache2/sites-available/$SITE.conf"
  fi
  return 0
}

apache_domain_owner() {
  apache2ctl -S 2>/dev/null | awk -v d="$DOMAIN" -v own="/$SITE.conf:" '
    $1 == "port" && $3 == "namevhost" && tolower($4) == d && index($0, own) == 0 { print $5; exit }
    $1 == "alias" && tolower($2) == d { print "(ServerAlias)"; exit }' || true
}

selinux_blocks_proxy() {
  have getenforce && have getsebool || return 1
  [ "$(getenforce 2>/dev/null || true)" = Enforcing ] || return 1
  [[ "$(getsebool httpd_can_network_connect 2>/dev/null || true)" == *"--> off"* ]]
}

valid_domain() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; }

# يحدد الوجهة وخادم الويب والمنافذ والحدود، دون أي تغيير على الخادم
resolve_plan() {
  gather
  local stored_domain stored_port
  stored_domain=$(cfg_get DOMAIN)
  stored_port=$(cfg_get PUBLIC_PORT)
  BRANCH=${OPT_BRANCH:-$(cfg_get BRANCH)}
  BRANCH=${BRANCH:-$DEFAULT_BRANCH}
  [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Invalid branch name: $BRANCH"
  EMAIL=${OPT_EMAIL:-$(cfg_get LE_EMAIL)}
  if [ -n "$EMAIL" ] && ! [[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then die "Invalid email: $EMAIL"; fi
  if [ -n "$OPT_BACKUP_KEY" ]; then
    [[ "$OPT_BACKUP_KEY" =~ ^[A-Za-z0-9._+/=-]{16,200}$ ]] || die "--backup-key must be at least 16 characters (letters, digits and . _ + / = - only)."
    local key; key=$(cfg_get BACKUP_ENCRYPTION_KEY)
    if [ -n "$key" ] && [ "$key" != "$OPT_BACKUP_KEY" ]; then die "This installation already has a different backup key. It cannot be replaced: its own backups depend on it."; fi
  fi

  if [ -n "$OPT_DOMAIN" ] && [ -n "$OPT_PORT" ]; then die "Use either --domain or --port, not both."; fi
  if [ -n "$OPT_DOMAIN" ]; then DOMAIN=$OPT_DOMAIN PUBLIC_PORT=''
  elif [ -n "$OPT_PORT" ]; then DOMAIN='' PUBLIC_PORT=$OPT_PORT
  elif [ -n "$stored_domain" ]; then DOMAIN=$stored_domain PUBLIC_PORT=''
  elif [ -n "$stored_port" ]; then DOMAIN='' PUBLIC_PORT=$stored_port
  else die "Choose how the system will be reached: --domain school.example.com (recommended) or --port 8090"
  fi
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
  if [ -n "$DOMAIN" ] && ! valid_domain "$DOMAIN"; then die "Invalid domain: $DOMAIN (example: school.example.com)"; fi

  if [ -n "$OPT_HTTPS" ]; then HTTPS=$OPT_HTTPS
  elif [ "$CMD" = install ] || [ "$CMD" = check ]; then HTTPS=1
  else HTTPS=$(cfg_get HTTPS); HTTPS=${HTTPS:-1}
  fi

  # خادم الويب: الاختيار الصريح، أو نفس اختيار التثبيت السابق لنفس النطاق، أو الاكتشاف التلقائي
  WEB_NOTE=''
  if [ -z "$DOMAIN" ]; then
    WEB=none
  else
    local req=${OPT_WEB:-}
    if [ -z "$req" ] && [ "$stored_domain" = "$DOMAIN" ]; then req=$(cfg_get WEB); fi
    req=${req:-auto}
    detect_web
    if [ "$req" = auto ]; then req=$WEB_DETECTED; fi
    WEB=$req
  fi
  case "$WEB" in
    nginx)
      nginx_layout
      if [ "$NGINX_BROKEN" = 1 ]; then web_fallback "nginx's current configuration does not pass 'nginx -t', so it is left untouched"
      elif [ -z "$NGINX_FILE" ]; then web_fallback "nginx is running, but its configuration is not in the standard layout (managed by a control panel?)"
      elif selinux_blocks_proxy; then web_fallback "SELinux does not allow the web server to reach the app (run: setsebool -P httpd_can_network_connect 1, then re-run)"
      fi ;;
    apache)
      apache_layout
      if [ -z "$APACHE_FILE" ]; then web_fallback "Apache is running, but not with the standard Debian/Ubuntu layout"
      elif selinux_blocks_proxy; then web_fallback "SELinux does not allow the web server to reach the app (run: setsebool -P httpd_can_network_connect 1, then re-run)"
      fi ;;
    caddy)
      if { [ -n "$OWNER80" ] && [ "$OWNER80" != ours ]; } || { [ -n "$OWNER443" ] && [ "$OWNER443" != ours ]; }; then
        web_fallback "ports 80/443 are already used by ${OWNER80:-?}/${OWNER443:-?}"
      fi ;;
    none) ;;
    *) die "Unknown --web value: $WEB (use auto, nginx, apache, caddy or none)" ;;
  esac

  # لا نأخذ نطاقًا يستخدمه موقع آخر
  local other=''
  if [ "$WEB" = nginx ]; then other=$(nginx_domain_owner); fi
  if [ "$WEB" = apache ]; then other=$(apache_domain_owner); fi
  if [ -n "$other" ]; then die "$DOMAIN is already configured in $other. Use a different subdomain for this system."; fi

  if [ -n "$DOMAIN" ]; then
    choose_local_port
    APP_PORT_BIND="127.0.0.1:$LOCAL_PORT"
  else
    choose_public_port
    LOCAL_PORT=$PUBLIC_PORT
    APP_PORT_BIND=$PUBLIC_PORT
  fi

  if [ "$CPUS" -ge 4 ]; then APP_CPUS=2 DB_CPUS=1
  elif [ "$CPUS" -ge 2 ]; then APP_CPUS=1 DB_CPUS=1
  else APP_CPUS=0.8 DB_CPUS=0.5
  fi
  if [ "$MEM_TOTAL" -ge 3072 ]; then APP_MEM=1536m DB_MEM=512m; else APP_MEM=1024m DB_MEM=384m; fi
}

web_fallback() {
  if [ -n "$OPT_WEB" ] && [ "$OPT_WEB" != auto ]; then die "$1."; fi
  WEB_NOTE=$1
  WEB=none
}

choose_local_port() {
  local cur p
  cur=$(cfg_get APP_LOCAL_PORT)
  if [ -n "$cur" ] && [ -z "$(cfg_get PUBLIC_PORT)" ] && { our_port "$cur" || ! port_used "$cur"; }; then LOCAL_PORT=$cur; return 0; fi
  for p in $(seq 3100 3199); do
    if ! port_used "$p"; then LOCAL_PORT=$p; return 0; fi
  done
  die "No free local port between 3100 and 3199."
}

choose_public_port() {
  PUBLIC_PORT=${PUBLIC_PORT:-8090}
  if ! [[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || [ "$PUBLIC_PORT" -lt 1024 ] || [ "$PUBLIC_PORT" -gt 65535 ]; then die "--port must be a number between 1024 and 65535."; fi
  if port_used "$PUBLIC_PORT" && ! our_port "$PUBLIC_PORT"; then
    local owner; owner=$(port_owner "$PUBLIC_PORT")
    die "Port $PUBLIC_PORT is already used by ${owner:-another program}. Choose another one with --port."
  fi
}

# مشاكل تمنع التثبيت (PROBLEMS) وتنبيهات (WARNINGS)
preflight() {
  PROBLEMS=() WARNINGS=()
  if [ "$DOCKER_OK" = 0 ]; then
    if [ "$INSTALL_DOCKER" = 0 ]; then PROBLEMS+=("Docker is not installed or not running. Install it (curl -fsSL https://get.docker.com | sh) or re-run with --install-docker."); fi
  elif [ -z "$COMPOSE_VER" ]; then
    PROBLEMS+=("Docker Compose v2 is missing (for example: apt-get install docker-compose-plugin).")
  fi
  local avail=$((MEM_AVAIL + SWAP_FREE))
  if [ "$avail" -lt "$MIN_BUILD_MB" ]; then
    local msg="Only ${avail} MB of memory is free (RAM + swap). Building needs about ${MIN_BUILD_MB} MB and could slow down the other apps on this server. Add swap or free memory, or re-run with --force at a quiet time."
    if [ "$FORCE" = 1 ]; then WARNINGS+=("$msg"); else PROBLEMS+=("$msg"); fi
  elif [ "$avail" -lt "$REC_BUILD_MB" ]; then
    WARNINGS+=("Free memory is ${avail} MB; building will take a few minutes and use about 1 GB. Prefer a quiet time.")
  fi
  if [ "$DISK_GB" -lt "$MIN_DISK_GB" ]; then
    local msg="Only ${DISK_GB} GB of disk space is free for Docker; about ${MIN_DISK_GB} GB is needed."
    if [ "$FORCE" = 1 ]; then WARNINGS+=("$msg"); else PROBLEMS+=("$msg"); fi
  fi
  if [ -n "$DOMAIN" ] && [ -z "$(resolve_ips "$DOMAIN")" ]; then
    WARNINGS+=("$DOMAIN does not resolve yet: add an A record for it pointing to this server's public IP.")
  fi
  if [ -n "$WEB_NOTE" ]; then WARNINGS+=("$WEB_NOTE — the system will listen on 127.0.0.1:$LOCAL_PORT and you add the reverse proxy yourself (instructions at the end)."); fi
  if [ "$WEB" = nginx ] && [ "$HTTPS" = 1 ] && [ -n "$OWNER443" ] && [[ "$OWNER443" != nginx* ]]; then
    WARNINGS+=("Port 443 is used by $OWNER443, not nginx: the system will be served over plain HTTP.")
  fi
  if [ "$WEB" = apache ] && [ "$HTTPS" = 1 ] && [ -n "$OWNER443" ] && [[ "$OWNER443" != apache2* && "$OWNER443" != httpd* ]]; then
    WARNINGS+=("Port 443 is used by $OWNER443, not Apache: the system will be served over plain HTTP.")
  fi
  return 0
}

print_facts() {
  step "This server"
  info "System:        $OS_NAME ($ARCH), $CPUS CPU"
  info "Memory:        $MEM_TOTAL MB total, $MEM_AVAIL MB free, $SWAP_FREE MB swap free"
  if [ "$DOCKER_OK" = 1 ]; then
    info "Docker:        $DOCKER_VER, Compose ${COMPOSE_VER:-missing}"
    info "Containers:    $OTHER_CONTAINERS running for other apps (they will not be touched)"
  else
    info "Docker:        not available"
  fi
  info "Disk free:     $DISK_GB GB"
  info "Ports 80/443:  ${OWNER80:-free} / ${OWNER443:-free}"
  if [ -n "$DOMAIN" ]; then
    local ips; ips=$(resolve_ips "$DOMAIN")
    info "Domain:        $DOMAIN -> ${ips:-(does not resolve yet)}   (this server: $(hostname -I 2>/dev/null || echo '?'))"
  fi
}

print_plan() {
  step "Plan"
  if [ "$DOCKER_OK" = 0 ] && [ "$INSTALL_DOCKER" = 1 ]; then info "- Install Docker with the official script (get.docker.com)"; fi
  info "- Code in $APP_DIR, settings (secret) in $CONFIG"
  info "- Docker project \"$PROJECT\": its own containers, network and volumes,"
  info "  with its own PostgreSQL database that is not published on any port"
  info "- Limits: app $APP_MEM RAM / $APP_CPUS CPU, database $DB_MEM RAM / $DB_CPUS CPU; logs rotated (3 x 10 MB)"
  case "$WEB" in
    nginx)
      info "- App on 127.0.0.1:$LOCAL_PORT behind nginx: new site file $NGINX_FILE"
      info "  (checked with nginx -t before a graceful reload; removed again if nginx rejects it)" ;;
    apache)
      info "- App on 127.0.0.1:$LOCAL_PORT behind Apache: new site $APACHE_FILE"
      info "  (enables proxy/headers modules if needed; checked with apache2ctl -t before a graceful reload)" ;;
    caddy)
      info "- Caddy web server inside the project on ports 80/443 (currently free), app on 127.0.0.1:$LOCAL_PORT" ;;
    none)
      if [ -n "$DOMAIN" ]; then info "- App on 127.0.0.1:$LOCAL_PORT; you point your web server/panel for $DOMAIN to it"
      else info "- App published on port $PUBLIC_PORT: http://$(server_ip):$PUBLIC_PORT (plain HTTP)"
      fi ;;
  esac
  if [ -n "$DOMAIN" ] && [ "$HTTPS" = 1 ] && [ "$WEB" != none ]; then info "- Free HTTPS certificate for $DOMAIN from Let's Encrypt, renewed automatically"; fi
  info "- Nothing else on this server is stopped or modified"
}

report_preflight() {
  local w p
  for w in ${WARNINGS[@]+"${WARNINGS[@]}"}; do warn "$w"; done
  for p in ${PROBLEMS[@]+"${PROBLEMS[@]}"}; do printf '  %s✘%s %s\n' "$RED" "$RESET" "$p" >&2; done
  [ ${#PROBLEMS[@]} -eq 0 ]
}

# ---------- التثبيت ----------
ensure_git() {
  if have git; then return 0; fi
  step "Installing git"
  if have apt-get; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q git >/dev/null \
      || { apt-get update -q >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -q git >/dev/null; }
  elif have dnf; then dnf install -y -q git >/dev/null
  elif have yum; then yum install -y -q git >/dev/null
  else die "git is required: install it, then re-run."
  fi
}

install_docker() {
  step "Installing Docker (official script from get.docker.com)"
  have curl || die "curl is required to install Docker."
  local f; f=$(mktemp)
  curl -fsSL https://get.docker.com -o "$f"
  sh "$f"
  rm -f "$f"
  if have systemctl; then systemctl enable --now docker >/dev/null 2>&1 || true; fi
  docker info >/dev/null 2>&1 || die "Docker was installed but is not running."
}

fetch_code() {
  ensure_git
  if [ -d "$APP_DIR/.git" ]; then
    step "Updating the code ($BRANCH)"
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    if [ "$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)" = "$BRANCH" ]; then
      git -C "$APP_DIR" merge --quiet --ff-only "origin/$BRANCH"
    else
      git -C "$APP_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    fi
  else
    step "Downloading the code ($BRANCH)"
    mkdir -p "$BASE_DIR"
    chmod 750 "$BASE_DIR"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
  ok "Version $(git -C "$APP_DIR" log -1 --format='%h (%cd)' --date=short)"
}

# يعيد تشغيل السكربت من النسخة التي نُزّلت للتو (لتنفيذ أحدث منطق)
reexec_from_checkout() {
  fetch_code
  SCHOOL_STAGE=fetched SCHOOL_CONFIRMED=1 exec bash "$APP_DIR/deploy/server.sh" "$CMD" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"}
}

write_config() {
  mkdir -p "$BASE_DIR"
  chmod 750 "$BASE_DIR"
  FIRST_INSTALL=0
  if [ ! -f "$CONFIG" ]; then
    FIRST_INSTALL=1
    printf '%s\n' \
      '# School accounting system: settings used by deploy/server.sh and Docker Compose.' \
      '# SECRET: contains the database password, the first admin password and the backup encryption key.' \
      '# Keep a copy of BACKUP_ENCRYPTION_KEY outside this server: backups cannot be restored without it.' > "$CONFIG"
    chmod 600 "$CONFIG"
  fi
  # أسرار تُنشأ مرة واحدة ولا تتغير بعدها
  if [ -z "$(cfg_get POSTGRES_PASSWORD)" ]; then cfg_set POSTGRES_PASSWORD "$(rand 32)"; fi
  if [ -z "$(cfg_get ADMIN_USERNAME)" ]; then cfg_set ADMIN_USERNAME admin; fi
  if [ -z "$(cfg_get ADMIN_PASSWORD)" ]; then cfg_set ADMIN_PASSWORD "$(rand 16)"; fi
  if [ -n "$OPT_BACKUP_KEY" ]; then cfg_set BACKUP_ENCRYPTION_KEY "$OPT_BACKUP_KEY"; fi
  if [ -z "$(cfg_get BACKUP_ENCRYPTION_KEY)" ]; then cfg_set BACKUP_ENCRYPTION_KEY "$(rand 48)"; fi
  cfg_set BRANCH "$BRANCH"
  cfg_set DOMAIN "$DOMAIN"
  cfg_set PUBLIC_PORT "$PUBLIC_PORT"
  cfg_set WEB "$WEB"
  cfg_set HTTPS "$HTTPS"
  cfg_set LE_EMAIL "$EMAIL"
  cfg_set APP_LOCAL_PORT "$LOCAL_PORT"
  cfg_set APP_PORT "$APP_PORT_BIND"
  cfg_set APP_CPUS "$APP_CPUS"
  cfg_set DB_CPUS "$DB_CPUS"
  cfg_set APP_MEM_LIMIT "$APP_MEM"
  cfg_set DB_MEM_LIMIT "$DB_MEM"
  cfg_set NGINX_FILE "${NGINX_FILE:-}"
  cfg_set NGINX_LINK "${NGINX_LINK:-}"
  cfg_set APACHE_FILE "${APACHE_FILE:-}"
  if [ -z "$(cfg_get INSTALLED_AT)" ]; then cfg_set INSTALLED_AT "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; fi
}

build_and_start() {
  step "Building the application image (several minutes the first time)"
  dc build || die "Building failed (see the output above). Nothing new was started and no web server was changed."
  step "Starting: database, then migrations, then the application"
  if ! dc up -d --remove-orphans; then
    dc logs --tail=60 migrate app >&2 || true
    die "Starting failed (see the logs above). No web server was changed."
  fi
  wait_healthy
}

wait_healthy() {
  local i out id
  for i in $(seq 1 120); do
    if have curl; then
      out=$(curl -fsS -m 5 "http://127.0.0.1:$LOCAL_PORT/api/health" 2>/dev/null || true)
      if grep -q '"ok":true' <<<"$out"; then ok "The system is running and connected to its database"; return 0; fi
    else
      id=$(dc ps -q app 2>/dev/null || true)
      out=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)
      if [ "$out" = healthy ]; then ok "The system is running and connected to its database"; return 0; fi
    fi
    sleep 2
  done
  dc logs --tail=80 app >&2 || true
  die "The system did not respond within 4 minutes (logs above)."
}

# ---------- خادم الويب ----------
cert_ready() { [ "$(cfg_get CERT_DOMAIN)" = "$DOMAIN" ] && [ -f "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" ]; }

web_reload() {
  case "$WEB" in
    nginx) if svc_active nginx; then systemctl reload nginx; else nginx -s reload; fi ;;
    apache) if svc_active apache2; then systemctl reload apache2; else apache2ctl graceful; fi ;;
  esac
}
reload_hook() {
  case "$WEB" in
    nginx) if svc_active nginx; then echo 'systemctl reload nginx'; else echo 'nginx -s reload'; fi ;;
    apache) if svc_active apache2; then echo 'systemctl reload apache2'; else echo 'apache2ctl graceful'; fi ;;
  esac
}

nginx_acme() {
  cat <<EOF
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
EOF
}
nginx_proxy() {
  cat <<EOF
        proxy_pass http://127.0.0.1:$LOCAL_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
EOF
}
nginx_conf() {
  local v6_80='' v6_443=''
  if [ "$NGINX_V6_80" = 1 ]; then v6_80=$'\n    listen [::]:80;'; fi
  if [ "$NGINX_V6_443" = 1 ]; then v6_443=$'\n    listen [::]:443 ssl;'; fi
  echo "# School accounting system - generated by deploy/server.sh (rewritten on every update; do not edit)"
  if [ "$1" = http ]; then
    cat <<EOF
server {
    listen 80;$v6_80
    server_name $DOMAIN;
    client_max_body_size 50m;

$(nginx_acme)

    location / {
$(nginx_proxy)
    }
}
EOF
  else
    cat <<EOF
server {
    listen 80;$v6_80
    server_name $DOMAIN;

$(nginx_acme)

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;$v6_443
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$CERT_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$CERT_NAME/privkey.pem;
    client_max_body_size 50m;

    location / {
$(nginx_proxy)
    }
}
EOF
  fi
}

apache_acme() {
  cat <<EOF
    Alias /.well-known/acme-challenge/ $ACME_ROOT/.well-known/acme-challenge/
    <Directory "$ACME_ROOT">
        Require all granted
    </Directory>
EOF
}
apache_proxy() {
  cat <<EOF
    ProxyRequests Off
    ProxyPreserveHost On
    ProxyTimeout 300
    RequestHeader unset X-Forwarded-For
    RequestHeader unset X-Forwarded-Host
    RequestHeader set X-Forwarded-Proto "$1"
    LimitRequestBody 52428800
    ProxyPass /.well-known/acme-challenge/ !
    ProxyPass / http://127.0.0.1:$LOCAL_PORT/
    ProxyPassReverse / http://127.0.0.1:$LOCAL_PORT/
EOF
}
apache_conf() {
  echo "# School accounting system - generated by deploy/server.sh (rewritten on every update; do not edit)"
  if [ "$1" = http ]; then
    cat <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
$(apache_acme)
$(apache_proxy http)
</VirtualHost>
EOF
  else
    cat <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
$(apache_acme)
    RedirectMatch 301 ^/(?!\.well-known/acme-challenge/)(.*)\$ https://$DOMAIN/\$1
</VirtualHost>

<VirtualHost *:443>
    ServerName $DOMAIN
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$CERT_NAME/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$CERT_NAME/privkey.pem
$(apache_proxy https)
</VirtualHost>
EOF
  fi
}

# يكتب ملف الموقع ويفحص إعدادات الخادم كاملة؛ إن رُفض يعيد كل شيء كما كان
nginx_apply() {
  local backup='' err
  mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
  chmod 755 "$ACME_ROOT" "$ACME_ROOT/.well-known" "$ACME_ROOT/.well-known/acme-challenge"
  if [ -f "$NGINX_FILE" ]; then backup=$(mktemp); cp -p "$NGINX_FILE" "$backup"; fi
  nginx_conf "$1" > "$NGINX_FILE"
  chmod 644 "$NGINX_FILE"
  if [ -n "$NGINX_LINK" ]; then ln -sfn "$NGINX_FILE" "$NGINX_LINK"; fi
  if ! err=$(nginx -t 2>&1); then
    if [ -n "$backup" ]; then cp -p "$backup" "$NGINX_FILE"; else rm -f "$NGINX_FILE" ${NGINX_LINK:+"$NGINX_LINK"}; fi
    rm -f "$backup"
    printf '%s\n' "$err" >&2
    die "nginx rejected the new site file, so it was removed again. nginx was not reloaded and keeps running as before."
  fi
  rm -f "$backup"
  web_reload
  ok "nginx site $DOMAIN active ($1)"
}

apache_apply() {
  local backup='' err m loaded mods=(proxy proxy_http headers alias) enabled=()
  if [ "$1" = https ]; then mods+=(ssl); fi
  mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
  chmod 755 "$ACME_ROOT" "$ACME_ROOT/.well-known" "$ACME_ROOT/.well-known/acme-challenge"
  loaded=$(apache2ctl -M 2>/dev/null || true)
  for m in "${mods[@]}"; do
    if ! grep -q " ${m}_module" <<<"$loaded"; then a2enmod -q "$m" >/dev/null; enabled+=("$m"); fi
  done
  if [ -f "$APACHE_FILE" ]; then backup=$(mktemp); cp -p "$APACHE_FILE" "$backup"; fi
  apache_conf "$1" > "$APACHE_FILE"
  chmod 644 "$APACHE_FILE"
  a2ensite -q "$SITE" >/dev/null
  if ! err=$(apache2ctl -t 2>&1); then
    if [ -n "$backup" ]; then cp -p "$backup" "$APACHE_FILE"; else a2dissite -q "$SITE" >/dev/null 2>&1 || true; rm -f "$APACHE_FILE"; fi
    for m in ${enabled[@]+"${enabled[@]}"}; do a2dismod -q -f "$m" >/dev/null 2>&1 || true; done
    rm -f "$backup"
    printf '%s\n' "$err" >&2
    die "Apache rejected the new site, so it was removed again. Apache was not reloaded and keeps running as before."
  fi
  rm -f "$backup"
  if [ ${#enabled[@]} -gt 0 ]; then info "Enabled Apache modules: ${enabled[*]}"; fi
  web_reload
  ok "Apache site $DOMAIN active ($1)"
}

web_verify() {
  have curl || return 0
  local i out url opts
  if [ "$1" = https ]; then url="https://$DOMAIN/api/health"; opts=(--resolve "$DOMAIN:443:127.0.0.1")
  else url="http://$DOMAIN/api/health"; opts=(--resolve "$DOMAIN:80:127.0.0.1")
  fi
  for i in $(seq 1 "${2:-10}"); do
    out=$(curl -fsS -m 10 "${opts[@]}" "$url" 2>/dev/null || true)
    if grep -q '"ok":true' <<<"$out"; then ok "Reachable through the web server: $url"; return 0; fi
    sleep 2
  done
  warn "Could not reach $url through the web server from this machine. Check it from a browser; if it fails, send the output of: server.sh status"
  return 0
}

certbot_bin() {
  if have certbot; then command -v certbot; elif [ -x /snap/bin/certbot ]; then echo /snap/bin/certbot; fi
  return 0
}

ensure_certbot() {
  CERTBOT=$(certbot_bin)
  if [ -n "$CERTBOT" ]; then return 0; fi
  step "Installing certbot (certificates only; no web server packages)"
  if have apt-get; then
    # لا نثبت certbot إذا كان سيسحب حزمة خادم ويب
    local sim; sim=$(apt-get install -s -y --no-install-recommends certbot 2>/dev/null || true)
    if grep -Eq '^Inst (nginx|apache2|httpd)' <<<"$sim"; then
      warn "Installing certbot would also install a web server package, so it was skipped."
      return 1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends certbot >/dev/null 2>&1 \
      || { apt-get update -q >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends certbot >/dev/null 2>&1; } \
      || return 1
  elif have dnf; then dnf install -y -q certbot >/dev/null 2>&1 || return 1
  else return 1
  fi
  CERTBOT=$(certbot_bin)
  [ -n "$CERTBOT" ]
}

port443_ok() {
  case "$WEB" in
    nginx) [ -z "$OWNER443" ] || [[ "$OWNER443" == nginx* ]] ;;
    apache) [ -z "$OWNER443" ] || [[ "$OWNER443" == apache2* || "$OWNER443" == httpd* ]] ;;
    *) return 1 ;;
  esac
}

# شهادة Let's Encrypt بطريقة webroot: لا تعدّل certbot أي ملف إعدادات لخادم الويب
obtain_cert() {
  if ! port443_ok; then warn "Port 443 is used by ${OWNER443:-?}: skipping HTTPS."; return 1; fi
  if ! ensure_certbot; then warn "certbot is not available: install it, then run: server.sh https"; return 1; fi
  step "Getting the HTTPS certificate for $DOMAIN"
  local token out old
  token=$(rand 32)
  printf '%s' "$token" > "$ACME_ROOT/.well-known/acme-challenge/$token"
  chmod 644 "$ACME_ROOT/.well-known/acme-challenge/$token"
  out=$(curl -fsS -m 10 "http://$DOMAIN/.well-known/acme-challenge/$token" 2>/dev/null || true)
  rm -f "$ACME_ROOT/.well-known/acme-challenge/$token"
  if [ "$out" = "$token" ]; then ok "$DOMAIN points to this server"
  else warn "Could not confirm from here that $DOMAIN points to this server (DNS not ready yet, or the provider blocks loopback). Trying anyway."
  fi
  old=$(cfg_get CERT_DOMAIN)
  if [ -n "$old" ] && [ "$old" != "$DOMAIN" ]; then "$CERTBOT" delete --cert-name "$CERT_NAME" --non-interactive >/dev/null 2>&1 || true; fi
  local args=(certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" --cert-name "$CERT_NAME" --non-interactive --agree-tos --keep-until-expiring --deploy-hook "$(reload_hook)")
  if [ -n "$EMAIL" ]; then args+=(--email "$EMAIL"); else args+=(--register-unsafely-without-email); fi
  if "$CERTBOT" "${args[@]}"; then
    cfg_set CERT_DOMAIN "$DOMAIN"
    return 0
  fi
  warn "The certificate could not be obtained. Make sure $DOMAIN has an A record pointing to this server (in Cloudflare: 'DNS only'), then run: server.sh https"
  return 1
}

write_caddyfile() {
  {
    echo "# School accounting system - generated by deploy/server.sh (rewritten on every update; do not edit)"
    if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
    if [ "$HTTPS" = 1 ]; then printf '%s {\n' "$DOMAIN"; else printf 'http://%s {\n' "$DOMAIN"; fi
    printf '\tencode gzip\n\trequest_body {\n\t\tmax_size 50MB\n\t}\n\treverse_proxy app:3000\n}\n'
  } > "$CADDYFILE"
  chmod 644 "$CADDYFILE"
}

# ملف موقعنا من التثبيت السابق: يُحذف فقط إذا تغيّر خادم الويب أو مساره (بعد أن يعمل الإصدار الجديد)
remember_old_site() {
  OLD_WEB=$(cfg_get WEB) OLD_NGINX_FILE=$(cfg_get NGINX_FILE) OLD_NGINX_LINK=$(cfg_get NGINX_LINK) OLD_APACHE_FILE=$(cfg_get APACHE_FILE)
}
remove_old_site() {
  if [ "${OLD_WEB:-}" = nginx ] && [ -n "$OLD_NGINX_FILE" ] && [ "$OLD_NGINX_FILE" != "${NGINX_FILE:-}" ] && [ -e "$OLD_NGINX_FILE" ]; then
    rm -f "$OLD_NGINX_FILE" ${OLD_NGINX_LINK:+"$OLD_NGINX_LINK"}
    if nginx -t >/dev/null 2>&1; then
      if svc_active nginx; then systemctl reload nginx; else nginx -s reload; fi
    fi
    ok "Removed the previous nginx site file"
  fi
  if [ "${OLD_WEB:-}" = apache ] && [ -n "$OLD_APACHE_FILE" ] && [ "$OLD_APACHE_FILE" != "${APACHE_FILE:-}" ] && [ -e "$OLD_APACHE_FILE" ]; then
    a2dissite -q "$SITE" >/dev/null 2>&1 || true
    rm -f "$OLD_APACHE_FILE"
    if apache2ctl -t >/dev/null 2>&1; then
      if svc_active apache2; then systemctl reload apache2; else apache2ctl graceful; fi
    fi
    ok "Removed the previous Apache site"
  fi
  return 0
}

# بعد أن يعمل التطبيق: موقع خادم الويب ثم الشهادة
setup_web() {
  case "$WEB" in
    nginx|apache)
      step "Adding the site $DOMAIN to $WEB"
      local mode=http
      if [ "$HTTPS" = 1 ] && cert_ready && port443_ok; then mode=https; fi
      "${WEB}_apply" "$mode"
      if [ "$HTTPS" = 1 ] && [ "$mode" = http ] && obtain_cert; then
        mode=https
        "${WEB}_apply" https
      fi
      web_verify "$mode" ;;
    caddy)
      # Caddyfile مربوط كملف: نعيد تحميل Caddy ليقرأ التعديلات
      dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || dc restart caddy >/dev/null
      if [ "$HTTPS" = 1 ]; then web_verify https 30; else web_verify http; fi ;;
  esac
  return 0
}

app_url() {
  if [ -z "$DOMAIN" ]; then echo "http://$(server_ip):$PUBLIC_PORT"
  elif [ "$WEB" = none ]; then echo "http://127.0.0.1:$LOCAL_PORT  (connect $DOMAIN to it in your web server)"
  elif [ "$HTTPS" = 1 ] && { [ "$WEB" = caddy ] || cert_ready; }; then echo "https://$DOMAIN"
  else echo "http://$DOMAIN"
  fi
}

print_manual_proxy() {
  step "Connect $DOMAIN to the system in your web server or control panel"
  info "Create a reverse proxy for $DOMAIN to http://127.0.0.1:$LOCAL_PORT that:"
  info "  - keeps the Host header and sets X-Forwarded-For and X-Forwarded-Proto"
  info "  - allows uploads of 50 MB and waits up to 300 seconds"
  info "Example for nginx:"
  info "  location / {"
  info "      proxy_pass http://127.0.0.1:$LOCAL_PORT;"
  info "      proxy_set_header Host \$host;"
  info "      proxy_set_header X-Forwarded-For \$remote_addr;"
  info "      proxy_set_header X-Forwarded-Proto \$scheme;"
  info "      client_max_body_size 50m;"
  info "  }"
}

print_done() {
  local line; line=$(printf '%*s' 66 '' | tr ' ' '=')
  printf '\n%s%s%s\n' "$GREEN" "$line" "$RESET"
  printf '  %sSchool accounting system is running%s\n\n' "$BOLD" "$RESET"
  printf '  Address:      %s\n' "$(app_url)"
  printf '  Username:     %s\n' "$(cfg_get ADMIN_USERNAME)"
  if [ "${FIRST_INSTALL:-0}" = 1 ]; then
    printf '  Password:     %s   (temporary: you will set a new one at first login)\n' "$(cfg_get ADMIN_PASSWORD)"
    printf '  Backup key:   %s\n' "$(cfg_get BACKUP_ENCRYPTION_KEY)"
    printf '                ^ keep a copy outside this server: backups cannot be restored without it\n'
  else
    printf '  Password:     unchanged (first-login details: sudo bash %s/deploy/server.sh info)\n' "$APP_DIR"
  fi
  printf '\n  Files:        %s   (settings: config.env)\n' "$BASE_DIR"
  printf '  Manage:       sudo bash %s/deploy/server.sh status | update | logs | info | uninstall\n' "$APP_DIR"
  printf '%s%s%s\n' "$GREEN" "$line" "$RESET"
}

# ---------- الأوامر ----------
cmd_check() {
  resolve_plan
  preflight
  print_facts
  print_plan
  step "Result"
  if report_preflight; then
    ok "Ready. Run the same command with 'install' instead of 'check'."
  else
    exit 1
  fi
}

cmd_install() {
  resolve_plan
  preflight
  if [ "${SCHOOL_STAGE:-}" != fetched ]; then
    print_facts
    print_plan
    step "Checks"
    report_preflight || die "Fix the problems above, then run the command again. Nothing was changed."
    if [ ${#WARNINGS[@]} -eq 0 ]; then ok "All checks passed"; fi
    echo
    confirm "Proceed with the installation? [y/N]" || die "Cancelled. Nothing was changed."
    take_lock
    if [ "$DOCKER_OK" = 0 ]; then install_docker; fi
    reexec_from_checkout
  fi
  report_preflight >/dev/null 2>&1 || { report_preflight || true; die "Fix the problems above, then run the command again."; }
  take_lock
  remember_old_site
  write_config
  if [ "$WEB" = caddy ]; then write_caddyfile; fi
  build_and_start
  remove_old_site
  setup_web
  if [ "$WEB" = none ] && [ -n "$DOMAIN" ]; then print_manual_proxy; fi
  print_done
}

cmd_update() {
  require_installed
  if [ "${SCHOOL_STAGE:-}" != fetched ]; then
    take_lock
    BRANCH=${OPT_BRANCH:-$(cfg_get BRANCH)}
    BRANCH=${BRANCH:-$DEFAULT_BRANCH}
    reexec_from_checkout
  fi
  take_lock
  resolve_plan
  preflight
  report_preflight || die "Fix the problems above, then run update again. The current version keeps running."
  remember_old_site
  write_config
  if [ "$WEB" = caddy ]; then write_caddyfile; fi
  build_and_start
  remove_old_site
  setup_web
  if [ "$WEB" = none ] && [ -n "$DOMAIN" ]; then print_manual_proxy; fi
  print_done
}

cmd_https() {
  require_installed
  take_lock
  OPT_HTTPS=1
  resolve_plan
  [ -n "$DOMAIN" ] || die "HTTPS needs a domain. Re-install with --domain school.example.com"
  case "$WEB" in
    nginx|apache)
      cfg_set HTTPS 1
      if obtain_cert; then "${WEB}_apply" https; web_verify https; else exit 1; fi ;;
    caddy)
      cfg_set HTTPS 1
      write_caddyfile
      setup_web ;;
    *) die "This installation does not manage a web server; enable HTTPS for $DOMAIN in your own web server or panel." ;;
  esac
  ok "Address: $(app_url)"
}

load_stored() {
  DOMAIN=$(cfg_get DOMAIN) PUBLIC_PORT=$(cfg_get PUBLIC_PORT) WEB=$(cfg_get WEB) HTTPS=$(cfg_get HTTPS)
  LOCAL_PORT=$(cfg_get APP_LOCAL_PORT) NGINX_FILE=$(cfg_get NGINX_FILE) NGINX_LINK=$(cfg_get NGINX_LINK) APACHE_FILE=$(cfg_get APACHE_FILE)
}

cmd_status() {
  require_installed
  load_stored
  step "Containers"
  dc ps
  step "Health"
  local out; out=$(curl -fsS -m 5 "http://127.0.0.1:$LOCAL_PORT/api/health" 2>/dev/null || true)
  if grep -q '"ok":true' <<<"$out"; then ok "Responding and connected to its database"; else warn "Not responding on 127.0.0.1:$LOCAL_PORT (see: server.sh logs)"; fi
  info "Address: $(app_url)"
  info "Version: $(git -C "$APP_DIR" log -1 --format='%h (%cd)' --date=short 2>/dev/null || echo '?')"
}

cmd_info() {
  require_installed
  load_stored
  step "School accounting system"
  info "Address:     $(app_url)"
  info "Username:    $(cfg_get ADMIN_USERNAME)"
  info "First-login password: $(cfg_get ADMIN_PASSWORD)   (only valid until it is changed at first login)"
  info "Backup key:  $(cfg_get BACKUP_ENCRYPTION_KEY)"
  info "             keep a copy outside this server: backups cannot be restored without it"
}

cmd_logs() {
  require_installed
  load_stored
  dc logs --tail=200 -f "$LOG_SERVICE" || true
}

cmd_uninstall() {
  case "$BASE_DIR" in /*/*) ;; *) die "Unsafe install folder: $BASE_DIR" ;; esac
  local ours=''
  if have docker; then ours=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null || true); fi
  if [ ! -f "$CONFIG" ] && [ ! -d "$APP_DIR" ] && [ -z "$ours" ]; then die "Nothing to remove: the system is not installed on this server."; fi
  load_stored
  step "This will remove"
  info "- The containers, network and images of the Docker project \"$PROJECT\""
  if [ "$KEEP_DATA" = 1 ]; then info "- (the database, uploaded files and $CONFIG are KEPT)"
  else info "- The system's database and uploaded files, and the folder $BASE_DIR"
  fi
  if [ "$WEB" = nginx ] && [ -n "$NGINX_FILE" ]; then info "- The nginx site file $NGINX_FILE"; fi
  if [ "$WEB" = apache ] && [ -n "$APACHE_FILE" ]; then info "- The Apache site $APACHE_FILE"; fi
  if [ -n "$(cfg_get CERT_DOMAIN)" ]; then info "- The HTTPS certificate \"$CERT_NAME\""; fi
  info "Nothing else on this server is touched."
  if [ "$KEEP_DATA" = 0 ]; then warn "If you may need the data later, first download a backup from the system: Settings -> Backups."; fi
  echo
  confirm_word DELETE "Type DELETE to remove the system:" || die "Cancelled. Nothing was removed."
  take_lock

  case "$WEB" in
    nginx)
      if [ -n "$NGINX_FILE" ] && { [ -e "$NGINX_FILE" ] || [ -L "$NGINX_LINK" ]; }; then
        rm -f "$NGINX_FILE" ${NGINX_LINK:+"$NGINX_LINK"}
        if nginx -t >/dev/null 2>&1; then web_reload; ok "nginx site removed"; else warn "nginx -t reports a problem unrelated to this system; nginx was not reloaded."; fi
      fi ;;
    apache)
      if [ -n "$APACHE_FILE" ] && [ -e "$APACHE_FILE" ]; then
        a2dissite -q "$SITE" >/dev/null 2>&1 || true
        rm -f "$APACHE_FILE"
        if apache2ctl -t >/dev/null 2>&1; then web_reload; ok "Apache site removed"; else warn "apache2ctl -t reports a problem unrelated to this system; Apache was not reloaded."; fi
      fi ;;
  esac
  if [ -n "$(cfg_get CERT_DOMAIN)" ]; then
    CERTBOT=$(certbot_bin)
    if [ -n "$CERTBOT" ]; then "$CERTBOT" delete --cert-name "$CERT_NAME" --non-interactive >/dev/null 2>&1 || true; ok "Certificate removed"; fi
  fi

  local down=(down --remove-orphans --rmi local)
  if [ "$KEEP_DATA" = 0 ]; then down+=(--volumes); fi
  if [ -f "$APP_DIR/docker-compose.yml" ] && [ -f "$CONFIG" ]; then
    DC_ALL=1 dc "${down[@]}"
  elif have docker; then
    # بدون ملفات المشروع: الحذف حسب وسم المشروع فقط
    if [ -n "$ours" ]; then docker rm -f $ours >/dev/null; fi
    docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" | xargs -r docker network rm >/dev/null
    if [ "$KEEP_DATA" = 0 ]; then docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | xargs -r docker volume rm >/dev/null; fi
  fi
  ok "Containers removed"

  rm -rf "$ACME_ROOT"
  if [ "$KEEP_DATA" = 1 ]; then
    rm -rf "$APP_DIR" "$CADDYFILE"
    ok "Kept the data volumes and $CONFIG (install again to use them)"
  else
    rm -rf "$BASE_DIR"
  fi
  ok "The system was removed from this server."
}

case "$CMD" in
  help|-h|--help) usage; exit 0 ;;
  check|install|update|status|info|logs|https|uninstall) ;;
  *) usage >&2; die "Unknown command: $CMD" ;;
esac
require_root
"cmd_$CMD"
