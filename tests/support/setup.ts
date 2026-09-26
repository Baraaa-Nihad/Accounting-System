import 'dotenv/config'
import os from 'node:os'
import path from 'node:path'

// كل الاختبارات تعمل على قاعدة بيانات الاختبار فقط
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
// ومجلد تخزين منفصل (المرفقات والنسخ الاحتياطية) حتى لا تختلط بملفات التطوير
process.env.STORAGE_DIR = process.env.TEST_STORAGE_DIR || path.join(os.tmpdir(), 'school-accounting-test-storage')
