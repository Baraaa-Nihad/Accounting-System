-- دور «مستخدم للعرض فقط» لا يطّلع على الرواتب (docs/04-roles-permissions.md §4.3)
UPDATE "roles" SET "permissions" = array_remove("permissions", 'salaries.view') WHERE "key" = 'viewer';
