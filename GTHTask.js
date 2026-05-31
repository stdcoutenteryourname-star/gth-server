const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    schoolId: { type: String, required: true },
    teacherName: { type: String, required: true },
    
    // التعديل الجذري هنا: وضعنا String داخل أقواس مربعة لتصبح مصفوفة (Array)
    section: { type: [String], required: true }, 
    
    taskType: { type: String, required: true, enum: ['واجب', 'بحث', 'اختبار'] },
    title: { type: String, required: true },
    description: { type: String },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    studyPlan: { type: String },
    week: { type: String }, 
    day: { type: String, required: true } 
});

module.exports = mongoose.model('Task', taskSchema);