import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import cors from "cors";
import fs from "fs";

const db = new Database("database.sqlite");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    password TEXT,
    role TEXT DEFAULT 'user',
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    price REAL DEFAULT 0,
    category TEXT,
    content TEXT,
    is_free INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    course_id INTEGER,
    status TEXT DEFAULT 'pending',
    payment_ref TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(course_id) REFERENCES courses(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    type TEXT, -- 'payment', 'win', 'loss', 'deposit'
    status TEXT DEFAULT 'completed',
    reference TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS forum_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    user_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES forum_posts(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Seed initial data if empty
const courseCount = db.prepare("SELECT COUNT(*) as count FROM courses").get() as { count: number };
if (courseCount.count === 0) {
  db.prepare("INSERT INTO courses (title, description, price, category, content, is_free) VALUES (?, ?, ?, ?, ?, ?)").run(
    "Introduction to Social Media",
    "Learn the basics of Facebook, Instagram, and Twitter.",
    0,
    "Basic",
    "Welcome to the world of social media...",
    1
  );
  db.prepare("INSERT INTO courses (title, description, price, category, content, is_free) VALUES (?, ?, ?, ?, ?, ?)").run(
    "Advanced Digital Marketing",
    "Master the art of online advertising and ROI.",
    5000,
    "Professional",
    "Advanced strategies for digital growth...",
    0
  );
  
  // Seed admin
  db.prepare("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)").run(
    "Admin User",
    "admin@smc.rw",
    "0788864202",
    "admin123",
    "admin"
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // API Routes
  app.post("/api/auth/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND password = ?").get(email, password);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.post("/api/auth/register", (req, res) => {
    const { name, email, phone, password } = req.body;
    try {
      const result = db.prepare("INSERT INTO users (name, email, phone, password) VALUES (?, ?, ?, ?)").run(name, email, phone, password);
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
      res.json(user);
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.get("/api/courses", (req, res) => {
    const courses = db.prepare("SELECT * FROM courses").all();
    res.json(courses);
  });

  app.post("/api/payments/momo", (req, res) => {
    const { userId, amount, phone, courseId } = req.body;
    // Simulate MoMo Payment
    const reference = "MOMO-" + Math.random().toString(36).substring(7).toUpperCase();
    
    db.prepare("INSERT INTO transactions (user_id, amount, type, reference) VALUES (?, ?, ?, ?)").run(
      userId, amount, 'payment', reference
    );

    if (courseId) {
      db.prepare("INSERT INTO enrollments (user_id, course_id, status, payment_ref) VALUES (?, ?, ?, ?)").run(
        userId, courseId, 'active', reference
      );
    }

    res.json({ success: true, reference, message: "Payment successful! SMS sent to " + phone });
  });

  app.get("/api/user/:id/enrollments", (req, res) => {
    const enrollments = db.prepare(`
      SELECT c.* FROM courses c
      JOIN enrollments e ON c.id = e.course_id
      WHERE e.user_id = ? AND e.status = 'active'
    `).all(req.params.id);
    res.json(enrollments);
  });

  app.get("/api/admin/reports", (req, res) => {
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get();
    const totalRevenue = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type = 'payment'").get();
    const recentTransactions = db.prepare("SELECT t.*, u.name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT 10").all();
    res.json({ totalUsers, totalRevenue, recentTransactions });
  });

  app.get("/api/forum/posts", (req, res) => {
    const posts = db.prepare(`
      SELECT p.*, u.name as author_name 
      FROM forum_posts p 
      JOIN users u ON p.user_id = u.id 
      ORDER BY p.created_at DESC
    `).all();
    res.json(posts);
  });

  app.post("/api/forum/posts", (req, res) => {
    const { userId, title, content } = req.body;
    const result = db.prepare("INSERT INTO forum_posts (user_id, title, content) VALUES (?, ?, ?)").run(userId, title, content);
    res.json({ id: result.lastInsertRowid });
  });

  app.get("/api/forum/posts/:id/comments", (req, res) => {
    const comments = db.prepare(`
      SELECT c.*, u.name as author_name 
      FROM forum_comments c 
      JOIN users u ON c.user_id = u.id 
      WHERE c.post_id = ? 
      ORDER BY c.created_at ASC
    `).all(req.params.id);
    res.json(comments);
  });

  app.post("/api/forum/comments", (req, res) => {
    const { userId, postId, content } = req.body;
    db.prepare("INSERT INTO forum_comments (post_id, user_id, content) VALUES (?, ?, ?)").run(postId, userId, content);
    res.json({ success: true });
  });

  app.post("/api/games/play", (req, res) => {
    const { userId, gameId, fee } = req.body;
    const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
    
    if (user.balance < fee) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const win = Math.random() > 0.7; // 30% win rate
    const prize = win ? fee * 5 : 0;
    const newBalance = user.balance - fee + prize;

    db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newBalance, userId);
    db.prepare("INSERT INTO transactions (user_id, amount, type, reference) VALUES (?, ?, ?, ?)").run(
      userId, prize - fee, win ? 'win' : 'loss', "GAME-" + Math.random().toString(36).substring(7).toUpperCase()
    );

    res.json({ success: true, win, prize, newBalance });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
