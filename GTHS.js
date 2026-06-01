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
.then(() => console.log("Connected"))
.catch(err => console.error("Error:", err));

function generateOTP() {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); 
    return { otp, otpExpires };
}

app.post('/reg', async (req, res) => {
    try {
        console.log(" البيانات المستلمة:", req.body);

        const { email, fullName, role, schoolId, section, pword } = req.body;
        
        if (!email || !pword || !fullName || !role) {
            return res.status(400).send("يوجد بيانات ناقصة");
        }

        const finalSchoolId = schoolId ? schoolId : "pending";
        const finalSection = section ? section : "";

        const hashedPassword = await bcrypt.hash(pword, 10);
        
        const newUser = new User({
            email: email.toLowerCase().trim(),
            fullName: fullName,
            role: role.toLowerCase().trim(),
            schoolId: finalSchoolId,
            section: finalSection,
            pword: hashedPassword,
            isVerified: true
        });

        await newUser.save();
        res.status(201).send("Created");
    } catch (err) {
        console.error(" تفاصيل خطأ التسجيل:", err.message);
        if (err.code === 11000) {
            return res.status(400).send("عذراً، هذا الإيميل مسجل مسبقاً.");
        }
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
        
        console.log("OTP:", otp);
        res.status(200).send("OTPSent");
    } catch(err) { 
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
        
        console.log("OTP:", otp);
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

app.post('/forgot-password', async (req, res) => {
    try {
        const email = req.body.email.toLowerCase().trim();
        const user = await User.findOne({ email });
        if(!user) return res.status(404).send("UserNotFound");

        const { otp, otpExpires } = generateOTP();
        await User.updateOne({ email }, { $set: { otp, otpExpires } });
        
        console.log("OTP:", otp);
        res.status(200).send("Sent");
    } catch(err) { res.status(500).send("Error"); }
});

app.post('/reset-password', async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const cleanEmail = email.toLowerCase().trim();
        
        const hpword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ email: cleanEmail }, { $set: { pword: hpword } });
        
        res.status(200).send("Success");
    } catch(err) { res.status(500).send("Error"); }
});

app.listen(3000, () => console.log("Run"));
