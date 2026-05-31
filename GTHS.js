require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');
const nodemailer = require('nodemailer'); 
const User = require('./GTHU');
const Task = require('./GTHTask');
const School = require('./GTHSchool');

const app = express();
app.use(cors());
app.use(express.urlencoded({extended: true}));
app.use(express.json());

mongoose.connect(process.env.DB_URI)
.then(() => console.log("Database connected successfully! 🚀"))
.catch(err => console.error("Database connection error:", err));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

function generateOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 
    return { otp, otpExpires };
}

// ==========================================
// 1. مسارات التسجيل والتحقق (نظام متكامل ومحمي)
// ==========================================
app.post('/reg', async (req, res) => {
    try {
        const { role, email, fullName, schoolId, section, pword, secretCode } = req.body;
        
        // تحقق من الأكواد السرية بصرامة
        if (role === 'teacher' && secretCode !== '2026') return res.status(400).send("InvalidTeacherCode");
        if (role === 'admin' && secretCode !== '1000') return res.status(400).send("InvalidAdminCode");
        
        const cleanEmail = email.toLowerCase().trim();
        const existingUser = await User.findOne({ email: cleanEmail });
        if(existingUser) return res.status(400).send("Taken");

        const hpword = await bcrypt.hash(pword, 10);
        const { otp, otpExpires } = generateOTP();
        
        // الإداري لا يملك مدرسة فوراً، يتم تعليق حسابه حتى ينشئها
        const finalSchoolId = role === 'admin' ? 'pending_school' : schoolId;

        const newUser = new User({ 
            email: cleanEmail, fullName, role, 
            schoolId: finalSchoolId, 
            section: role === 'student' ? section : undefined, 
            pword: hpword, otp, otpExpires, isVerified: false
        });

        await newUser.save();
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER, to: cleanEmail,
            subject: 'رمز التفعيل - الجدول الذكي', 
            text: `مرحباً ${fullName}،\nرمز التحقق الخاص بك هو: ${otp}`
        });

        res.status(201).send("Created");
    } catch(err) { 
        console.error("Registration Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/verify-otp', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const otp = req.body.otp.trim();
        
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");
        if(user.otp !== otp) return res.status(400).send("WrongOTP");
        if(user.otpExpires < new Date()) return res.status(400).send("ExpiredOTP");

        // تحديث الحساب وحذف الـ OTP للحماية
        await User.updateOne({ email }, { 
            $set: { isVerified: true }, 
            $unset: { otp: 1, otpExpires: 1 } 
        });

        // جلب البيانات النظيفة (بدون الباسورد) لإرسالها للمتصفح
        const updatedUser = await User.findOne({ email }).select('-pword');
        res.status(200).json(updatedUser);
    } catch(err) { 
        console.error("Verify OTP Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/login', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(400).send("Wrong");
        
        const isMatch = await bcrypt.compare(req.body.pword, user.pword);
        if(!isMatch) return res.status(400).send("Wrong");
        
        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        await transporter.sendMail({ 
            from: process.env.EMAIL_USER, to: email, 
            subject: 'رمز تسجيل الدخول - الجدول الذكي', 
            text: `مرحباً ${user.fullName}،\nرمز الدخول الخاص بك: ${otp}` 
        });

        res.status(200).send("OTPSent");
    } catch(err) { 
        console.error("Login Error:", err);
        res.status(500).send("Error"); 
    }
});

// ==========================================
// 2. إدارة المدارس والطلاب (لوحة تحكم الإدارة)
// ==========================================
app.get('/get-schools', async (req, res) => {
    try { res.status(200).json(await School.find()); } 
    catch (err) { res.status(500).send("Error"); }
});

app.post('/manage-school', async (req, res) => {
    try {
        const { action, schoolName, newSection, adminEmail, schoolId } = req.body;
        
        if (action === 'create') {
            const existingSchool = await School.findOne({ adminEmail });
            if (existingSchool) return res.status(400).send("AdminAlreadyHasSchool");

            // خوارزمية ذكية لاستخراج أعلى ID لمنع التعارض المستقبلي
            const allSchools = await School.find();
            let maxId = 0;
            allSchools.forEach(s => {
                let idNum = parseInt(s.schoolId);
                if (!isNaN(idNum) && idNum > maxId) maxId = idNum;
            });
            const newSchoolId = (maxId + 1).toString();

            const newSchool = new School({ schoolId: newSchoolId, schoolName, adminEmail });
            await newSchool.save();
            
            await User.updateOne({ email: adminEmail }, { $set: { schoolId: newSchoolId } });
            res.status(201).send("SchoolCreated");
            
        } else if (action === 'addSection') {
            const school = await School.findOne({ schoolId });
            if(!school) return res.status(404).send("SchoolNotFound");
            
            // استخدام addToSet لمنع إضافة نفس الشعبة مرتين (حماية إضافية)
            await School.updateOne({ schoolId }, { $addToSet: { sections: newSection } });
            res.status(200).send("SectionAdded");
        }
    } catch(err) { 
        console.error("Manage School Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/admin/users', async (req, res) => {
    try {
        const users = await User.find({ schoolId: req.body.schoolId, role: { $in: ['student', 'teacher'] } }).select('-pword -otp -otpExpires');
        res.status(200).json(users);
    } catch(err) { 
        console.error("Admin Get Users Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/admin/update-user', async (req, res) => {
    try {
        const { userEmail, newSection, teacherSections } = req.body;
        const updateData = {};
        if (newSection !== undefined) updateData.section = newSection;
        if (teacherSections !== undefined) updateData.teacherSections = teacherSections;

        await User.updateOne({ email: userEmail }, { $set: updateData });
        res.status(200).send("UserUpdated");
    } catch(err) { 
        console.error("Admin Update User Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/admin/delete-user', async (req, res) => {
    try { 
        await User.deleteOne({ email: req.body.userEmail }); 
        res.status(200).send("UserDeleted"); 
    } catch(err) { 
        console.error("Delete User Error:", err);
        res.status(500).send("Error"); 
    }
});

// ==========================================
// 3. إدارة المهام (محرك الجدول)
// ==========================================
app.post('/add-task', async (req, res) => {
    try {
        const { schoolId, teacherName, week, day, section, taskType, title, description, fromDate, toDate, studyPlan } = req.body;
        const newTask = new Task({ schoolId, teacherName, week, day, section, taskType, title, description, fromDate, toDate, studyPlan });
        await newTask.save();
        res.status(201).send("TaskAdded");
    } catch(err) { 
        console.error("Add Task Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/get-tasks', async (req, res) => {
    try {
        const { schoolId, role, section, teacherSections } = req.body;
        let query = { schoolId };
        
        if (role === 'student') {
            query.section = section;
        } else if (role === 'teacher') {
            query.section = { $in: teacherSections || [] };
        }
        
        const tasks = await Task.find(query);
        res.status(200).json(tasks);
    } catch(err) { 
        console.error("Get Tasks Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/delete-task', async (req, res) => {
    try { 
        await Task.findByIdAndDelete(req.body.taskId); 
        res.status(200).send("Deleted"); 
    } catch(err) { 
        console.error("Delete Task Error:", err);
        res.status(500).send("Error"); 
    }
});

// ==========================================
// مسارات إعادة إرسال الرمز ونسيت كلمة المرور
// ==========================================

// 1. إعادة إرسال الرمز (Resend OTP)
app.post('/resend-otp', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");

        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER, to: email,
            subject: 'إعادة إرسال رمز التحقق - الجدول الذكي', 
            text: `رمز التحقق الجديد الخاص بك هو: ${otp}`
        });
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

// 2. طلب إعادة تعيين كلمة المرور (Forgot Password)
app.post('/forgot-password', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");

        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER, to: email,
            subject: 'إعادة تعيين كلمة المرور - الجدول الذكي', 
            text: `طلبنا هذا الرمز لإعادة تعيين كلمة المرور. الرمز هو: ${otp}`
        });
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

// 3. حفظ كلمة المرور الجديدة
app.post('/reset-password', async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        
        const hpword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ email: cleanEmail }, { $set: { pword: hpword } });
        
        res.status(200).send("Success");
    } catch(err) { res.status(500).send("Error"); }
});

app.listen(3000, () => console.log("Server running on port 3000 🚀"));