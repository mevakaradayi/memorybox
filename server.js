const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname)); // Serve HTML, Images, etc.

const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize or load data
function getData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {}, photos: {} }));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/signup', (req, res) => {
  const { email, password, name } = req.body;
  const data = getData();
  
  if (data.users[email]) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  data.users[email] = { name, password, createdAt: Date.now() };
  data.photos[email] = []; // Initialize empty photo array
  saveData(data);
  
  res.json({ success: true, user: { email, name } });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const data = getData();
  
  const user = data.users[email];
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  res.json({ success: true, user: { email, name: user.name } });
});

// ============ PHOTO ROUTES ============

// Get photos for a user
app.get('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const photos = data.photos[userId] || [];
  res.json(photos);
});

// Add a photo
app.post('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  
  if (!data.photos[userId]) {
    data.photos[userId] = [];
  }
  
  const photo = {
    id: Date.now().toString(),
    imageData: req.body.imageData,
    caption: req.body.caption || '',
    angle: req.body.angle,
    radius: req.body.radius,
    group: req.body.group || null,
    createdAt: Date.now()
  };
  
  data.photos[userId].push(photo);
  saveData(data);
  res.json(photo);
});

// Update a photo (caption)
app.patch('/api/photos/:userId/:photoId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const photos = data.photos[userId] || [];
  const photo = photos.find(p => p.id === req.params.photoId);
  
  if (photo) {
    if (req.body.caption !== undefined) photo.caption = req.body.caption;
    saveData(data);
    res.json(photo);
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Delete a photo
app.delete('/api/photos/:userId/:photoId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  
  if (data.photos[userId]) {
    data.photos[userId] = data.photos[userId].filter(p => p.id !== req.params.photoId);
    saveData(data);
  }
  res.json({ success: true });
});

// Clear all photos for a user
app.delete('/api/photos/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  data.photos[userId] = [];
  saveData(data);
  res.json({ success: true });
});

// ============ USER ROUTES ============

// Get all users (for browsing boxes)
app.get('/api/users', (req, res) => {
  const data = getData();
  const users = Object.entries(data.users).map(([email, user]) => ({
    id: email,
    name: user.name,
    photoCount: (data.photos[email] || []).length
  }));
  res.json(users);
});

// Get user info
app.get('/api/users/:userId', (req, res) => {
  const data = getData();
  const userId = decodeURIComponent(req.params.userId);
  const user = data.users[userId];
  
  if (user) {
    res.json({ id: userId, name: user.name });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✨ Memory Box server running at http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT}/login.html to start`);
});