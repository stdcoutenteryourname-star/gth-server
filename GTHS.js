require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const cors = require('cors');

const User = require('./GTHU');
const Task = require('./GTHTask');
const School = require('./GTHSchool');

const app = express();
app.use(cors());
app.use(express.urlencoded({extended: true}));
app.use(express.json());

mongoose.connect(process.env.DB_URI)
.then(() => console.log("✅ Connected to Database"))
.catch(err => console.error("❌ Error connecting to database:", err));

// ==========================================
// محرك إرسال الإيميلات الاحترافي (عبر API لتخطي حظر Render)
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
        console.error("Brevo API Error:", errorData);
        throw new Error("فشل الإرسال عبر API");
    }
    return await response.json();
}

function generateOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 
    return { otp, otpExpires };
}

// ==========================================
// مسارات التسجيل والدخول
// ==========================================
app.post('/reg', async (req, res) => {
    try {
        const { email, fullName, role, schoolId, section, pword } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        
        if (!cleanEmail || !pword || !fullName || !role) {
            return res.status(400).send("يوجد بيانات ناقصة");
        }

        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            if (existingUser.isVerified) {
                return res.status(400).send("عذراً، هذا الإيميل مسجل مسبقاً ومفعل.");
            } else {
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

        await newUser.save();

        try {
            // إرسال الإيميل عبر الـ API
            await sendEmailAPI(
                cleanEmail, 
                'رمز التحقق - الجدول الذكي', 
                `مرحباً ${fullName}،\nرمز التحقق الخاص بك هو: ${otp}`
            );
            res.status(200).send("Sent");
        } catch (emailError) {
            console.error("خطأ في إرسال الإيميل:", emailError);
            await User.deleteOne({ email: cleanEmail });
            return res.status(500).send("فشل إرسال رمز التحقق.");
        }

    } catch (err) {
        console.error("Registration Error:", err.message);
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

        await User.updateOne({ email }, { 
            $set: { isVerified: true }, 
            $unset: { otp: 1, otpExpires: 1 } 
        });

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
        
        await sendEmailAPI(
            email,
            'رمز تسجيل الدخول - الجدول الذكي',
            `مرحباً ${user.fullName}،\nرمز الدخول الخاص بك هو: ${otp}`
        );

        res.status(200).send("OTPSent");
    } catch(err) { 
        console.error("Login Error:", err);
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
        
        await sendEmailAPI(
            email,
            'إعادة إرسال رمز التحقق - الجدول الذكي',
            `رمز التحقق الجديد الخاص بك هو: ${otp}`
        );

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
        
        await sendEmailAPI(
            email,
            'إعادة تعيين كلمة المرور - الجدول الذكي',
            `طلبنا هذا الرمز لإعادة تعيين كلمة المرور. الرمز هو: ${otp}`
        );

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

// ==========================================
// مسارات المدارس والمهام
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

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
