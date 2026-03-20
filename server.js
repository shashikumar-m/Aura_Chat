// ═══════════════════════════════════════════════════════════
//  Aura Chat — Complete Server
//  Features: DMs, Groups, Read Receipts, Last Seen, Typing,
//            WebRTC Signaling, Reactions, Requests, Push, etc.
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const allowedOrigins = [
  "http://localhost:3000",
  "https://chatwithme23.netlify.app",
  "https://aura-chat-di62.onrender.com"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});
app.use(express.json({ limit: '20mb' }));   // for base64 images
app.use(express.static(path.join(__dirname, 'public')));

// ────────────────────────────────────────────────────────────
//  MONGODB CONNECTION
// ────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/aurachat';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ────────────────────────────────────────────────────────────
//  SCHEMAS & MODELS
// ────────────────────────────────────────────────────────────

// User
const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true },
  avatar:    { type: String, default: '' },
  bio:       { type: String, default: '' },
  password:  { type: String, default: '' },
  lastSeen:  { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Message
const messageSchema = new mongoose.Schema({
  room:     { type: String, required: true, index: true },
  username: { type: String, required: true },
  message:  { type: String, default: '' },
  image:    { type: String, default: '' },
  replyTo:  { type: mongoose.Schema.Types.Mixed, default: null },
  msgId:    { type: String, unique: true, sparse: true },
  isGroup:  { type: Boolean, default: false },
  seenBy:   [{ type: String }],
  reactions:{ type: Map, of: Object, default: {} },
  deleted:  { type: Boolean, default: false },
  createdAt:{ type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Chat Request
const requestSchema = new mongoose.Schema({
  from:      { type: String, required: true },
  to:        { type: String, required: true },
  status:    { type: String, enum: ['pending','accepted','rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Request = mongoose.model('Request', requestSchema);

// Group
const groupSchema = new mongoose.Schema({
  groupId:   { type: String, required: true, unique: true },
  name:      { type: String, required: true },
  members:   [{ type: String }],
  admin:     { type: String, required: true },
  avatar:    { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Group = mongoose.model('Group', groupSchema);

// ────────────────────────────────────────────────────────────
//  IN-MEMORY ONLINE TRACKING
// ────────────────────────────────────────────────────────────
const onlineUsers = new Map();   // username -> socketId
const socketToUser = new Map();  // socketId -> username

// ────────────────────────────────────────────────────────────
//  REST ENDPOINTS
// ────────────────────────────────────────────────────────────

// ── LOGIN ──
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const user = await User.findOne({ username: username.trim() });
    if (!user)
      return res.status(404).json({ error: 'User not found. Please register first.' });
    if (user.password !== password)
      return res.status(401).json({ error: 'Incorrect password' });
    res.json({ success: true, username: user.username, avatar: user.avatar, bio: user.bio });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── REGISTER ──
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || username.trim().length < 2)
      return res.status(400).json({ error: 'Username must be at least 2 characters' });
    if (!password || password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    const exists = await User.findOne({ username: username.trim() });
    if (exists)
      return res.status(409).json({ error: 'Username already taken' });
    const user = await User.create({ username: username.trim(), password });
    res.json({ success: true, username: user.username });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Server error' });
  }
});

// List all users
app.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username avatar bio lastSeen').sort({ username: 1 });
    res.json(users);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Send chat request
app.post('/send-request', async (req, res) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'Missing fields' });
    const exists = await Request.findOne({ from, to, status: { $in: ['pending', 'accepted'] } });
    if (exists) return res.json({ success: true, status: exists.status });
    await Request.create({ from, to });
    // Notify recipient via socket
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('newRequest', { from });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Check permission
app.get('/check-permission', async (req, res) => {
  try {
    const { user1, user2 } = req.query;
    const req1 = await Request.findOne({ from: user1, to: user2 });
    const req2 = await Request.findOne({ from: user2, to: user1 });
    const found = req1 || req2;
    if (!found) return res.json({ status: 'none' });
    res.json({ status: found.status });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Get pending requests for a user
app.get('/requests', async (req, res) => {
  try {
    const { username } = req.query;
    const reqs = await Request.find({ to: username, status: 'pending' });
    res.json(reqs);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Accept request
app.post('/accept-request', async (req, res) => {
  try {
    const { from, to } = req.body;
    await Request.updateOne({ from, to, status: 'pending' }, { status: 'accepted' });
    // Notify sender
    const senderSocket = onlineUsers.get(from);
    if (senderSocket) io.to(senderSocket).emit('requestAccepted', { by: to });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Reject request
app.post('/reject-request', async (req, res) => {
  try {
    const { from, to } = req.body;
    await Request.updateOne({ from, to, status: 'pending' }, { status: 'rejected' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Get groups for a user
app.get('/groups', async (req, res) => {
  try {
    const { username } = req.query;
    const groups = await Group.find({ members: username });
    res.json(groups);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Get last seen
app.get('/last-seen', async (req, res) => {
  try {
    const { username } = req.query;
    const user = await User.findOne({ username }, 'lastSeen');
    res.json({ lastSeen: user?.lastSeen || null });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ────────────────────────────────────────────────────────────
//  SOCKET.IO
// ────────────────────────────────────────────────────────────

// ── SERVE LOGIN PAGE ──
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── AUTH GUARD: redirect to login if no username cookie ──
// (Frontend handles this via localStorage — server just serves the pages)

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  // ── USER ONLINE ──
  socket.on('userOnline', async (username) => {
    onlineUsers.set(username, socket.id);
    socketToUser.set(socket.id, username);
    socket.username = username;

    // Update lastSeen to null (online now)
    await User.updateOne({ username }, { lastSeen: null }, { upsert: true });

    // Broadcast online status
    io.emit('userStatus', { username, status: 'online', lastSeen: null });
    console.log(`✅ ${username} is online`);

    // Send this user their group list
    const groups = await Group.find({ members: username });
    socket.emit('groupsList', groups);
    // Auto-join group rooms
    groups.forEach(g => socket.join(g.groupId));
  });

  // ── JOIN ROOM ──
  socket.on('joinRoom', async ({ username, room }) => {
    socket.join(room);
    // Send chat history (last 100 messages)
    const msgs = await Message.find({ room, deleted: false }).sort({ createdAt: 1 }).limit(100);
    socket.emit('chatHistory', msgs);
    // Mark all messages in this room as seen by this user
    await Message.updateMany({ room, seenBy: { $ne: username } }, { $addToSet: { seenBy: username } });
    // Emit seen events back to senders
    const unread = await Message.find({ room, seenBy: username });
    unread.forEach(m => {
      if (m.username !== username) {
        const senderSocket = onlineUsers.get(m.username);
        if (senderSocket) io.to(senderSocket).emit('messageSeen', { msgId: m.msgId, by: username });
      }
    });
  });

  // ── SEND MESSAGE ──
  socket.on('sendMessage', async (data) => {
    const { username, room, message, image, to, replyTo, msgId, isGroup } = data;
    try {
      // Save to DB
      const saved = await Message.create({ room, username, message, image, replyTo, msgId, isGroup, seenBy: [username] });
      const payload = {
        username, message, image, replyTo, msgId: saved.msgId || saved._id.toString(),
        room, isGroup, timestamp: saved.createdAt
      };
      // Broadcast to room
      io.to(room).emit('receiveMessage', payload);

      // If DM: notify recipient if offline via socket event
      if (!isGroup && to) {
        const recipientSocket = onlineUsers.get(to);
        if (!recipientSocket) {
          // They're offline — could trigger push here with web-push library
          console.log(`📬 ${to} is offline — message queued`);
        }
      }
    } catch (e) {
      console.error('sendMessage error:', e.message);
    }
  });

  // ── MESSAGE SEEN ──
  socket.on('messageSeen', async ({ msgId, room, by }) => {
    try {
      const msg = await Message.findOneAndUpdate(
        { msgId, seenBy: { $ne: by } },
        { $addToSet: { seenBy: by } }
      );
      if (msg && msg.username !== by) {
        const senderSocket = onlineUsers.get(msg.username);
        if (senderSocket) io.to(senderSocket).emit('messageSeen', { msgId, by });
      }
    } catch (e) {}
  });

  // ── DELETE MESSAGE ──
  socket.on('deleteMessage', async ({ msgId, room, username }) => {
    try {
      const msg = await Message.findOne({ msgId });
      if (!msg || msg.username !== username) return;
      await Message.updateOne({ msgId }, { deleted: true, message: '', image: '' });
      io.to(room).emit('messageDeleted', { msgId });
    } catch (e) {}
  });

  // ── TYPING ──
  socket.on('typing', ({ room, username }) => {
    socket.to(room).emit('userTyping', { username, room });
  });
  socket.on('stopTyping', ({ room, username }) => {
    socket.to(room).emit('userStopTyping', { username, room });
  });

  // ── REACTIONS ──
  socket.on('reactMessage', async ({ msgId, emoji, username, room }) => {
    try {
      // Update in DB
      const key = `reactions.${emoji}`;
      await Message.updateOne(
  { msgId },
  {
    $addToSet: { [`reactions.${emoji}.users`]: username }
  }
);
      io.to(room).emit('newReaction', { msgId, emoji, user: username });
    } catch (e) {}
  });

  // ── GET LAST SEEN ──
  socket.on('getLastSeen', async ({ username: targetUser }) => {
    try {
      const user = await User.findOne({ username: targetUser }, 'lastSeen');
      socket.emit('userLastSeen', { username: targetUser, lastSeen: user?.lastSeen || null });
    } catch (e) {}
  });

  // ── CREATE GROUP ──
  socket.on('createGroup', async (groupData) => {
    try {
      const { groupId, name, members, admin, avatar } = groupData;
      const existing = await Group.findOne({ groupId });
      if (existing) return;
      const group = await Group.create({ groupId, name, members, admin, avatar });
      // Join the room for all online members
      members.forEach(m => {
        const mSocket = onlineUsers.get(m);
        if (mSocket) {
          io.to(mSocket).emit('groupCreated', group);
          // Make them join the socket room
          const s = io.sockets.sockets.get(mSocket);
          if (s) s.join(groupId);
        }
      });
    } catch (e) { console.error('createGroup error:', e.message); }
  });

  // ── GET MY GROUPS ──
  socket.on('getMyGroups', async ({ username }) => {
    try {
      const groups = await Group.find({ members: username });
      socket.emit('groupsList', groups);
      groups.forEach(g => socket.join(g.groupId));
    } catch (e) {}
  });

  // ── GROUP ADMIN: UPDATE NAME/AVATAR ──
  socket.on('updateGroup', async ({ groupId, name, avatar, requestedBy }) => {
    try {
      const group = await Group.findOne({ groupId });
      if (!group || group.admin !== requestedBy) return;
      if (name) group.name = name;
      if (avatar) group.avatar = avatar;
      await group.save();
      io.to(groupId).emit('groupUpdated', group);
    } catch (e) {}
  });

  // ── GROUP ADMIN: REMOVE MEMBER ──
  socket.on('removeMember', async ({ groupId, memberToRemove, requestedBy }) => {
    try {
      const group = await Group.findOne({ groupId });
      if (!group || group.admin !== requestedBy) return;
      if (memberToRemove === group.admin) return;
      group.members = group.members.filter(m => m !== memberToRemove);
      await group.save();
      const mSocket = onlineUsers.get(memberToRemove);
      if (mSocket) io.to(mSocket).emit('removedFromGroup', { groupId, groupName: group.name });
      io.to(groupId).emit('memberRemoved', { groupId, member: memberToRemove });
    } catch (e) {}
  });

  // ── WEBRTC SIGNALING ──
  socket.on('callUser', ({ to, from, offer }) => {
    const recipientSocket = onlineUsers.get(to);
    if (recipientSocket) {
      io.to(recipientSocket).emit('incomingCall', { from, offer });
    }
  });
  socket.on('callAnswer', ({ to, answer }) => {
    const callerSocket = onlineUsers.get(to);
    if (callerSocket) io.to(callerSocket).emit('callAnswered', { answer });
  });
  socket.on('iceCandidate', ({ to, candidate }) => {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) io.to(targetSocket).emit('iceCandidate', { candidate });
  });
  socket.on('rejectCall', ({ to, from }) => {
    const callerSocket = onlineUsers.get(to);
    if (callerSocket) io.to(callerSocket).emit('callRejected', { from });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', async () => {
    const user = socketToUser.get(socket.id);
    if (user) {
      onlineUsers.delete(user);
      socketToUser.delete(socket.id);
      const lastSeen = new Date();
      await User.updateOne({ username: user }, { lastSeen });
      io.emit('userStatus', { username: user, status: 'offline', lastSeen });
      console.log(`❌ ${user} disconnected — lastSeen saved`);
    }
  });
});

// ────────────────────────────────────────────────────────────
//  START SERVER
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Aura Chat server running on port ${PORT}`));