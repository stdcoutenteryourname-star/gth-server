require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');

// استيراد النماذج (Models)
const User = require('./GTHU');
const Task = require('./GTHTask');
const School = require('./GTHSchool');

const app = express();

// 1. إعدادات CORS (يجب أن تكون في البداية)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.options('*', cors());

// 2. نظام تتبع الطلبات (لأغراض التصحيح)
app.use((req, res, next) => {
    console.log(`🌐 [طلب جديد] ${req.method} ${req.url} | Body: ${JSON.stringify(req.body)}`);
    next();
});

app.use(express.urlencoded({extended: true}));
app.use(express.json());

// 3. الاتصال بقاعدة البيانات
mongoose.connect(process.env.DB_URI)
.then(() => console.log("✅ [DB] Connected successfully"))
.catch(err => console.error("❌ [DB] Connection failed:", err));

// ==========================================
// محرك إرسال الإيميلات الاحترافي (API Brevo)
// ==========================================
async function sendEmailAPI(toEmail, subject, textContent) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: { email: process.env.EMAIL_USER, name: 'الجدول الذكي' },
            to: [{ email: toEmail }],
            subject: subject,
            textContent: textContent
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ [API] Brevo Error:", errorData);
        throw new Error("فشل الإرسال عبر API");
    }
    return true;
}

function generateOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 
    return { otp, otpExpires };
}

// ==========================================
// المسارات (Routes)
// ==========================================

// تسجيل المستخدم
app.post('/reg', async (req, res) => {
    try {
        const { email, fullName, role, schoolId, section, pword } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        
        if (!cleanEmail || !pword || !fullName || !role) return res.status(400).send("يوجد بيانات ناقصة");

        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            if (existingUser.isVerified) return res.status(400).send("عذراً، هذا الإيميل مسجل مسبقاً ومفعل.");
            await User.deleteOne({ email: cleanEmail });
        }

        const hashedPassword = await bcrypt.hash(pword, 10);
        const { otp, otpExpires } = generateOTP();
        
        const newUser = new User({
            email: cleanEmail,
            fullName: fullName,
            role: role.toLowerCase().trim(),
            schoolId: schoolId || "pending",
            section: section || "",
            pword: hashedPassword,
            otp,
            otpExpires,
            isVerified: false
        });

        await newUser.save();

        try {
            await sendEmailAPI(cleanEmail, 'رمز التحقق - الجدول الذكي', `مرحباً ${fullName}،\nرمز التحقق الخاص بك هو: ${otp}`);
            res.status(200).send("Sent");
        } catch (emailError) {
            await User.deleteOne({ email: cleanEmail });
            res.status(500).send("فشل إرسال رمز التحقق.");
        }
    } catch (err) {
        console.error("🔥 Error in /reg:", err.message);
        res.status(500).send("Error");
    }
});

// التحقق من الرمز
app.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if(!user || user.otp !== otp || user.otpExpires < new Date()) return res.status(400).send("Invalid");
        
        await User.updateOne({ email: email.toLowerCase().trim() }, { 
            $set: { isVerified: true }, 
            $unset: { otp: 1, otpExpires: 1 } 
        });
        res.status(200).json(await User.findOne({ email: email.toLowerCase().trim() }).select('-pword'));
    } catch(err) { res.status(500).send("Error"); }
});

// تسجيل الدخول
app.post('/login', async (req, res) => {
    try {
        const { email, pword } = req.body;
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if(!user || !(await bcrypt.compare(pword, user.pword))) return res.status(400).send("Wrong");
        
        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email: email.toLowerCase().trim() }, { $set: { otp, otpExpires } });
        
        await sendEmailAPI(email, 'رمز تسجيل الدخول', `رمز الدخول الخاص بك هو: ${otp}`);
        res.status(200).send("OTPSent");
    } catch(err) { res.status(500).send("Error"); }
});

// المسارات الأخرى (المدارس والمهام)
app.get('/get-schools', async (req, res) => { try { res.status(200).json(await School.find()); } catch (err) { res.status(500).send("Error"); } });

app.post('/manage-school', async (req, res) => {
    try {
        const { action, schoolName, newSection, adminEmail, schoolId } = req.body;
        if (action === 'create') {
            const allSchools = await School.find();
            const newSchoolId = (allSchools.length > 0 ? Math.max(...allSchools.map(s => parseInt(s.schoolId))) + 1 : 1).toString();
            const newSchool = new School({ schoolId: newSchoolId, schoolName, adminEmail });
            await newSchool.save();
            await User.updateOne({ email: adminEmail }, { $set: { schoolId: newSchoolId } });
            res.status(201).send("SchoolCreated");
        } else if (action === 'addSection') {
            await School.updateOne({ schoolId }, { $addToSet: { sections: newSection } });
            res.status(200).send("SectionAdded");
        }
    } catch(err) { res.status(500).send("Error"); }
});

app.post('/admin/users', async (req, res) => { try { res.status(200).json(await User.find({ schoolId: req.body.schoolId }).select('-pword')); } catch(err) { res.status(500).send("Error"); } });

app.post('/admin/update-user', async (req, res) => { 
    try { await User.updateOne({ email: req.body.userEmail }, { $set: req.body }); res.status(200).send("UserUpdated"); } catch(err) { res.status(500).send("Error"); } 
});

app.post('/admin/delete-user', async (req, res) => { try { await User.deleteOne({ email: req.body.userEmail }); res.status(200).send("UserDeleted"); } catch(err) { res.status(500).send("Error"); } });

app.post('/add-task', async (req, res) => { try { const newTask = new Task(req.body); await newTask.save(); res.status(201).send("TaskAdded"); } catch(err) { res.status(500).send("Error"); } });

app.post('/get-tasks', async (req, res) => { 
    try { 
        let query = { schoolId: req.body.schoolId };
        if(req.body.role === 'student') query.section = req.body.section;
        else if(req.body.role === 'teacher') query.section = { $in: req.body.teacherSections || [] };
        res.status(200).json(await Task.find(query)); 
    } catch(err) { res.status(500).send("Error"); } 
});

app.post('/delete-task', async (req, res) => { try { await Task.findByIdAndDelete(req.body.taskId); res.status(200).send("Deleted"); } catch(err) { res.status(500).send("Error"); } });

// مسارات إضافية
app.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email: email.toLowerCase().trim() }, { $set: { otp, otpExpires } });
        await sendEmailAPI(email, 'إعادة إرسال رمز التحقق', `رمزك هو: ${otp}`);
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

app.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email: email.toLowerCase().trim() }, { $set: { otp, otpExpires } });
        await sendEmailAPI(email, 'إعادة تعيين كلمة المرور', `رمزك هو: ${otp}`);
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

app.post('/reset-password', async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        await User.updateOne({ email: email.toLowerCase().trim() }, { $set: { pword: await bcrypt.hash(newPassword, 10) } });
        res.status(200).send("Success");
    } catch(err) { res.status(500).send("Error"); }
});

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
