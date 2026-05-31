const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
    schoolId: { type: String, required: true, unique: true },
    schoolName: { type: String, required: true },
    sections: { type: [String], default: [] },
    adminEmail: { type: String, required: true } // لربط المدرسة بالإداري الذي أنشأها
});

module.exports = mongoose.model('School', schoolSchema);