const mongoose = require('mongoose');

const users = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    fullName: { type: String, required: true },
    role: { type: String, required: true, enum: ['teacher', 'student', 'admin'] },
    
    schoolId: { type: String, required: true }, // نستخدم ID المدرسة للربط الدقيق
    section: { type: String, required: false }, // للطالب (شعبة واحدة)
    teacherSections: { type: [String], default: [] }, // للمعلم (يمكن للإداري إعطاؤه عدة شعب)
    
    pword: { type: String, required: true },
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', users);