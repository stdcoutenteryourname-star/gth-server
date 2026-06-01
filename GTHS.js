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
.then(() => console.log("Connected to Database"))
.catch(err => console.error("Error connecting to database:", err));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { 
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

function generateOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 
    return { otp, otpExpires };
}

transporter.verify(function(error, success) {
    if (error) {
        console.log("❌ [إنذار] خطأ في الاتصال بجوجل، تحقق من الإيميل أو الباسورد:", error.message);
    } else {
        console.log("✅ [نجاح] سيرفر الإيميل جاهز وموثق 100% لإرسال الرموز!");
    }
});

app.post('/reg', async (req, res) => {
    console.log("=== 🚀 [1] استلام طلب تسجيل جديد ===");
    console.log("📦 البيانات المستلمة:", req.body);

    try {
        const { email, fullName, role, schoolId, section, pword } = req.body;
        
        // فحص وجود البيانات الأساسية
        if (!email || !pword || !fullName || !role) {
            console.log("❌ [2] تم رفض الطلب: توجد بيانات ناقصة");
            return res.status(400).send("يوجد بيانات ناقصة");
        }

        const cleanEmail = email.toLowerCase().trim();
        console.log(`🔍 [2] جاري فحص الإيميل: ${cleanEmail}`);

        // حماية ضد الحسابات المعلقة
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            if (existingUser.isVerified) {
                console.log("⚠️ [3] الإيميل مسجل ومفعل مسبقاً");
                return res.status(400).send("عذراً، هذا الإيميل مسجل مسبقاً ومفعل.");
            } else {
                console.log("🗑️ [3] جاري تنظيف حساب قديم غير مفعل...");
                await User.deleteOne({ email: cleanEmail });
            }
        }

        const finalSchoolId = schoolId ? schoolId : "pending";
        const finalSection = section ? section : "";
        const hashedPassword = await bcrypt.hash(pword, 10);
        const { otp, otpExpires } = generateOTP();
        
        const newUser = new User({
            email: cleanEmail,
            fullName: fullName,
            role: role.toLowerCase().trim(),
            schoolId: finalSchoolId,
            section: finalSection,
            pword: hashedPassword,
            otp: otp,
            otpExpires: otpExpires,
            isVerified: false
        });

        console.log("💾 [4] جاري حفظ بيانات المستخدم في قاعدة البيانات...");
        await newUser.save();
        console.log("✅ [5] تم الحفظ بنجاح!");

        console.log("📧 [6] جاري الاتصال بجوجل لإرسال الإيميل...");
        try {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: cleanEmail,
                subject: 'رمز التحقق - الجدول الذكي',
                text: `مرحباً ${fullName}،\nرمز التحقق الخاص بك هو: ${otp}`
            });
            console.log("✅ [7] تم إرسال الإيميل بنجاح للمستخدم!");
            res.status(200).send("Sent");
        } catch (emailError) {
            console.error("❌ [خطأ كارثي في الإيميل]:", emailError.message);
            console.log("↩️ [8] جاري حذف الحساب (Rollback) بسبب فشل الإيميل...");
            await User.deleteOne({ email: cleanEmail });
            return res.status(500).send("فشل إرسال رمز التحقق.");
        }

    } catch (err) {
        console.error("❌ [خطأ عام في السيرفر]:", err.message);
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
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'رمز تسجيل الدخول - الجدول الذكي',
            text: `مرحباً ${user.fullName}،\nرمز الدخول الخاص بك هو: ${otp}`
        });

        res.status(200).send("OTPSent");
    } catch(err) { 
        console.error("Login Error:", err);
        res.status(500).send("Error"); 
    }
});

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
            
            await School.updateOne({ schoolId }, { $addToSet: { sections: newSection } });
            res.status(200).send("SectionAdded");
        }
    } catch(err) { 
        res.status(500).send("Error"); 
    }
});

app.post('/admin/users', async (req, res) => {
    try {
        const users = await User.find({ schoolId: req.body.schoolId, role: { $in: ['student', 'teacher'] } }).select('-pword -otp -otpExpires');
        res.status(200).json(users);
    } catch(err) { 
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
        res.status(500).send("Error"); 
    }
});

app.post('/admin/delete-user', async (req, res) => {
    try { 
        await User.deleteOne({ email: req.body.userEmail }); 
        res.status(200).send("UserDeleted"); 
    } catch(err) { 
        res.status(500).send("Error"); 
    }
});

app.post('/add-task', async (req, res) => {
    try {
        const { schoolId, teacherName, week, day, section, taskType, title, description, fromDate, toDate, studyPlan } = req.body;
        const newTask = new Task({ schoolId, teacherName, week, day, section, taskType, title, description, fromDate, toDate, studyPlan });
        await newTask.save();
        res.status(201).send("TaskAdded");
    } catch(err) { 
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
        res.status(500).send("Error"); 
    }
});

app.post('/delete-task', async (req, res) => {
    try { 
        await Task.findByIdAndDelete(req.body.taskId); 
        res.status(200).send("Deleted"); 
    } catch(err) { 
        res.status(500).send("Error"); 
    }
});

app.post('/resend-otp', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");

        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'إعادة إرسال رمز التحقق - الجدول الذكي',
            text: `رمز التحقق الجديد الخاص بك هو: ${otp}`
        });

        res.status(200).send("Sent");
    } catch(err) { 
        console.error("Resend OTP Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/forgot-password', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");

        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'إعادة تعيين كلمة المرور - الجدول الذكي',
            text: `طلبنا هذا الرمز لإعادة تعيين كلمة المرور. الرمز هو: ${otp}`
        });

        res.status(200).send("Sent");
    } catch(err) { 
        console.error("Forgot Password Error:", err);
        res.status(500).send("Error"); 
    }
});

app.post('/reset-password', async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        
        const hpword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ email: cleanEmail }, { $set: { pword: hpword } });
        
        res.status(200).send("Success");
    } catch(err) { 
        res.status(500).send("Error"); 
    }
});

app.listen(3000, () => console.log("Server running on port 3000 🚀"));
