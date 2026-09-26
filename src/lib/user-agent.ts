/** وصف مختصر للجهاز والمتصفح من user-agent (للجلسات ومحاولات الدخول). */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'جهاز غير معروف'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'متصفح'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return os ? `${browser} على ${os}` : browser
}

export const LOGIN_REASON: Record<string, string> = {
  bad_password: 'كلمة مرور خاطئة',
  bad_password_locked: 'كلمة مرور خاطئة — قُفل الحساب',
  unknown_user: 'اسم مستخدم غير موجود',
  locked: 'الحساب مقفل',
  disabled: 'الحساب معطّل',
  ip_throttled: 'محاولات كثيرة من نفس الجهاز',
}
