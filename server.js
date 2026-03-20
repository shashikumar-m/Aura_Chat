const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const onlineUsers = {};
// Middleware
app.use(express.json());
app.use(express.static('public'));



// ================== MONGODB ==================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));

// Schema + Model (IMPORTANT: before socket use)
const messageSchema = new mongoose.Schema({
    username: String,
    room: String,
    message: String,
    image: { type: String, default: '' },
    time: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.model('Message', messageSchema);

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', userSchema);

// ================== AUTH ROUTES ==================

// REGISTER
app.post('/register', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({ success: false, message: "Missing fields" });
    }

    try {
        // Check if user exists
        const existing = await User.findOne({ username });
        if (existing) {
            return res.json({ success: false, message: "User already exists" });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save user
        await User.create({
            username,
            password: hashedPassword
        });

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});

// LOGIN
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }

        // Compare password
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.json({ success: false, message: "Wrong password" });
        }

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server error" });
    }
});








app.post('/send-request', async (req, res) => {
    const { from, to } = req.body;

    const exists = await ChatRequest.findOne({
        $or: [
            { from, to },
            { from: to, to: from }
        ]
    });

    if (exists) {
        return res.json({ message: "Request already exists" });
    }

    await ChatRequest.create({ from, to });

    // 🔥 REAL-TIME NOTIFICATION
    if (onlineUsers[to]) {
        io.to(onlineUsers[to]).emit('newRequest', {
            from
        });
    }

    res.json({ message: "Request sent" });
});

const chatRequestSchema = new mongoose.Schema({
    from: String,
    to: String,
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending'
    }
});

const ChatRequest = mongoose.model('ChatRequest', chatRequestSchema);

app.get('/requests', async (req, res) => {
    const { username } = req.query;

    const requests = await ChatRequest.find({
        to: username,
        status: 'pending'
    });

    res.json(requests);
});
app.post('/reject-request', async (req, res) => {
    const { from, to } = req.body;

    await ChatRequest.findOneAndUpdate(
        { from, to },
        { status: 'rejected' }
    );

    res.json({ message: "Rejected" });
});
app.get('/check-permission', async (req, res) => {
    try {
        const { user1, user2 } = req.query;

        const request = await ChatRequest.findOne({
            $or: [
                { from: user1, to: user2 },
                { from: user2, to: user1 }
            ]
        });

        if (!request) {
            return res.json({ status: "none" });
        }

        res.json({ status: request.status });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/accept-request', async (req, res) => {
    const { from, to } = req.body;

    await ChatRequest.findOneAndUpdate(
        { from, to },
        { status: 'accepted' }
    );

    res.json({ message: "Accepted" });
});

// ================== ROOM ==================

// CREATE ROOM
app.get('/create-room', (req, res) => {
    const roomId = uuidv4();
    res.json({ roomId });
});

// ================== SOCKET.IO ==================
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ✅ USER ONLINE (MOVE HERE)
    socket.on('userOnline', (username) => {
        onlineUsers[username] = socket.id;

        io.emit('userStatus', {
            username,
            status: 'online'
        });
    });

    // ✅ JOIN ROOM
    socket.on('joinRoom', async ({ username, room }) => {
        socket.join(room);

        const messages = await Message.find({ room }).sort({ time: 1 });
        socket.emit('chatHistory', messages);
    });

    // ── TYPING INDICATORS ──────────────────────────────────
socket.on('typing', ({ room, username }) => {
    socket.to(room).emit('userTyping', { room, username });
});

socket.on('stopTyping', ({ room, username }) => {
    socket.to(room).emit('userStopTyping', { room, username });
});

// ── EMOJI REACTIONS ────────────────────────────────────
socket.on('reactMessage', ({ msgId, emoji, username, room }) => {
    socket.to(room).emit('newReaction', { msgId, emoji, user: username });
});

// ── DELETE MESSAGE ─────────────────────────────────────
socket.on('deleteMessage', async ({ msgId, room, username }) => {
    try {
        await Message.findOneAndDelete({ _id: msgId, username });

        io.to(room).emit('messageDeleted', { msgId });
    } catch (err) {
        console.error('Delete error:', err);
    }
});

    // ✅ SEND MESSAGE
socket.on('sendMessage', async ({ username, room, message, to, image, replyTo }) => {

    const allowed = await ChatRequest.findOne({
        $or: [
            { from: username, to, status: 'accepted' },
            { from: to, to: username, status: 'accepted' }
        ]
    });

    if (!allowed) return;

    const saved = await Message.create({
        username,
        room,
        message: message || '',
        image: image || ''
    });

    io.to(room).emit('receiveMessage', {
        username,
        message: message || '',
        image: image || '',
        msgId: saved._id.toString(),
        replyTo: replyTo || null
    });
});

    // ✅ DISCONNECT (MOVE HERE)
    socket.on('disconnect', () => {
        const user = Object.keys(onlineUsers).find(
            key => onlineUsers[key] === socket.id
        );

        if (user) {
            delete onlineUsers[user];

            io.emit('userStatus', {
                username: user,
                status: 'offline'
            });
        }

        console.log('User disconnected:', socket.id);
    });
});




app.get('/users', async (req, res) => {
    const users = await User.find({}, { username: 1, _id: 0 });
    res.json(users);
});

function generateRoom(user1, user2) {
    return [user1, user2].sort().join("_");
}


// ================== SERVER ==================
server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});