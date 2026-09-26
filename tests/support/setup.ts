import 'dotenv/config'

// كل الاختبارات تعمل على قاعدة بيانات الاختبار فقط
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
