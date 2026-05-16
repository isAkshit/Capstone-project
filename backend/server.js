const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "library_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool = null;
let usingDatabase = false;

const memory = {
    users: [],
    books: [],
    borrowRequests: [],
    fines: [],
    nextUserId: 1,
    nextBookId: 1,
    nextRequestId: 1,
    nextFineId: 1
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: process.env.SESSION_SECRET || "circulib-demo-secret",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 3
        }
    })
);

app.get("/", (req, res) => {
    res.redirect("/homepage/index.html");
});

app.get("/home", (req, res) => {
    res.redirect("/homepage/index.html");
});

app.get("/login", (req, res) => {
    res.redirect("/login/login.html");
});

app.use(express.static(path.join(__dirname, "..")));

function normalizeRole(role) {
    return role === "admin" ? "admin" : "member";
}

function getRedirectForRole(role) {
    return role === "admin" ? "/admin/admin_page.html" : "/student/st_page.html";
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id || user.member_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: normalizeRole(user.role)
    };
}

function toTitleCase(value) {
    return String(value || "Library Book")
        .trim()
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function sampleGoogleBooks(query = "") {
    const search = query.toLowerCase().trim();
    const sampleBooks = [
        {
            google_id: "sample-atomic-habits",
            title: "Atomic Habits",
            author: "James Clear",
            category: "Self-help",
            cover_url: "https://m.media-amazon.com/images/I/81ANaVZk5LL.jpg"
        },
        {
            google_id: "sample-rich-dad-poor-dad",
            title: "Rich Dad Poor Dad",
            author: "Robert T. Kiyosaki",
            category: "Personal finance",
            cover_url: "https://m.media-amazon.com/images/I/81BE7eeKzAL.jpg"
        },
        {
            google_id: "sample-hobbit",
            title: "The Hobbit",
            author: "J.R.R. Tolkien",
            category: "Fantasy",
            cover_url: "https://m.media-amazon.com/images/I/7108sdE9u+L.jpg"
        },
        {
            google_id: "sample-1984",
            title: "1984",
            author: "George Orwell",
            category: "Dystopian",
            cover_url: "https://m.media-amazon.com/images/I/71kxa1-0mfL.jpg"
        },
        {
            google_id: "sample-alchemist",
            title: "The Alchemist",
            author: "Paulo Coelho",
            category: "Fiction",
            cover_url: "https://m.media-amazon.com/images/I/810u9MFEK8L.jpg"
        },
        {
            google_id: "sample-clean-code",
            title: "Clean Code",
            author: "Robert C. Martin",
            category: "Programming",
            cover_url: "https://m.media-amazon.com/images/I/41xShlnTZTL.jpg"
        }
    ];

    const matches = sampleBooks.filter((book) => {
        return [book.title, book.author, book.category].some((value) =>
            value.toLowerCase().includes(search)
        );
    });

    if (matches.length) {
        return [...matches, ...sampleBooks.filter((book) => !matches.includes(book))].slice(0, 5);
    }

    if (search) {
        return [
            {
                google_id: `sample-${search.replace(/\s+/g, "-")}`,
                title: toTitleCase(query),
                author: "Google Books sample result",
                category: "General",
                cover_url: "https://via.placeholder.com/120x180?text=Book"
            },
            ...sampleBooks.slice(0, 4)
        ];
    }

    return sampleBooks.slice(0, 5);
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ ok: false, message: "Please login first" });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.status(403).json({ ok: false, message: "Admin access required" });
    }
    next();
}

async function comparePassword(plainPassword, storedPassword) {
    if (!storedPassword) return false;
    if (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$")) {
        return bcrypt.compare(plainPassword, storedPassword);
    }
    return plainPassword === storedPassword;
}

async function createDatabase() {
    const connection = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        multipleStatements: true
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
    await connection.end();
}

async function createTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS members (
            member_id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            phone VARCHAR(15),
            email VARCHAR(100) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role ENUM('member','admin') DEFAULT 'member',
            joined_at DATE DEFAULT (CURRENT_DATE)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS libraries (
            library_id INT AUTO_INCREMENT PRIMARY KEY,
            library_name VARCHAR(100) NOT NULL,
            admin_id INT,
            FOREIGN KEY (admin_id) REFERENCES members(member_id)
                ON DELETE SET NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS books (
            book_id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(150) NOT NULL,
            author VARCHAR(120),
            category VARCHAR(50),
            available_copies INT DEFAULT 1,
            total_stock INT DEFAULT 1,
            mode ENUM('online','offline') DEFAULT 'offline',
            library_id INT,
            cover_url VARCHAR(500),
            FOREIGN KEY (library_id) REFERENCES libraries(library_id)
                ON DELETE SET NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS issued_books (
            issue_id INT AUTO_INCREMENT PRIMARY KEY,
            book_id INT NOT NULL,
            member_id INT NOT NULL,
            issue_date DATE,
            return_date DATE,
            days_requested INT DEFAULT 7,
            status ENUM('Pending','Granted','Rejected','returned') DEFAULT 'Pending',
            due_date DATE,
            FOREIGN KEY (book_id) REFERENCES books(book_id)
                ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members(member_id)
                ON DELETE CASCADE
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS fines (
            fine_id INT AUTO_INCREMENT PRIMARY KEY,
            member_id INT NOT NULL,
            amount DECIMAL(10,2) DEFAULT 0,
            reason VARCHAR(255),
            status ENUM('paid','unpaid') DEFAULT 'unpaid',
            FOREIGN KEY (member_id) REFERENCES members(member_id)
                ON DELETE CASCADE
        )
    `);
}

async function seedDatabase() {
    const adminPassword = await bcrypt.hash("1234", 10);
    const memberPassword = await bcrypt.hash("1234", 10);

    await pool.query(
        `INSERT IGNORE INTO members (name, phone, email, password, role, joined_at)
         VALUES
         ('Admin User', '9999999999', 'admin@gmail.com', ?, 'admin', CURRENT_DATE),
         ('Student User', '8888888888', 'student@gmail.com', ?, 'member', CURRENT_DATE)`,
        [adminPassword, memberPassword]
    );

    const [[library]] = await pool.query("SELECT library_id FROM libraries LIMIT 1");
    let libraryId = library ? library.library_id : null;

    if (!libraryId) {
        const [[admin]] = await pool.query("SELECT member_id FROM members WHERE role = 'admin' LIMIT 1");
        const [result] = await pool.query(
            "INSERT INTO libraries (library_name, admin_id) VALUES (?, ?)",
            ["CircuLib Central Library", admin.member_id]
        );
        libraryId = result.insertId;
    }

    const [[bookCount]] = await pool.query("SELECT COUNT(*) AS count FROM books");
    if (bookCount.count === 0) {
        await pool.query(
            `INSERT INTO books
                (title, author, category, available_copies, total_stock, mode, library_id, cover_url)
             VALUES
                (?, ?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?, ?),
                (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                "The Hobbit", "J.R.R. Tolkien", "Fantasy", 3, 4, "offline", libraryId, "https://m.media-amazon.com/images/I/7108sdE9u+L.jpg",
                "1984", "George Orwell", "Dystopian", 2, 3, "offline", libraryId, "https://m.media-amazon.com/images/I/71kxa1-0mfL.jpg",
                "A Brief History of Time", "Stephen Hawking", "Science", 1, 2, "offline", libraryId, "https://m.media-amazon.com/images/I/81Pz-0oX9XL.jpg",
                "The Alchemist", "Paulo Coelho", "Fiction", 4, 5, "online", libraryId, "https://m.media-amazon.com/images/I/810u9MFEK8L.jpg"
            ]
        );
    }

    const [[requestCount]] = await pool.query("SELECT COUNT(*) AS count FROM issued_books");
    if (requestCount.count === 0) {
        const [[member]] = await pool.query("SELECT member_id FROM members WHERE role = 'member' LIMIT 1");
        const [[book]] = await pool.query("SELECT book_id FROM books LIMIT 1");
        await pool.query(
            `INSERT INTO issued_books
                (book_id, member_id, issue_date, days_requested, status, due_date)
             VALUES (?, ?, CURRENT_DATE, 7, 'Pending', DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY))`,
            [book.book_id, member.member_id]
        );
    }
}

async function connectDatabase() {
    try {
        await createDatabase();
        pool = mysql.createPool(dbConfig);
        await createTables();
        await seedDatabase();
        usingDatabase = true;
        console.log("Connected to MySQL database:", dbConfig.database);
    } catch (error) {
        usingDatabase = false;
        pool = null;
        console.log("MySQL connection failed. Using in-memory demo data.");
        console.log("Reason:", error.code || error.message);
        await seedMemory();
    }
}

async function seedMemory() {
    const adminPassword = await bcrypt.hash("1234", 10);
    const memberPassword = await bcrypt.hash("1234", 10);

    memory.users = [
        {
            id: memory.nextUserId++,
            name: "Admin User",
            phone: "9999999999",
            email: "admin@gmail.com",
            password: adminPassword,
            role: "admin"
        },
        {
            id: memory.nextUserId++,
            name: "Student User",
            phone: "8888888888",
            email: "student@gmail.com",
            password: memberPassword,
            role: "member"
        }
    ];

    memory.books = [
        { id: memory.nextBookId++, title: "The Hobbit", author: "J.R.R. Tolkien", category: "Fantasy", available_copies: 3, total_stock: 4, mode: "offline", cover_url: "https://m.media-amazon.com/images/I/7108sdE9u+L.jpg" },
        { id: memory.nextBookId++, title: "1984", author: "George Orwell", category: "Dystopian", available_copies: 2, total_stock: 3, mode: "offline", cover_url: "https://m.media-amazon.com/images/I/71kxa1-0mfL.jpg" },
        { id: memory.nextBookId++, title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", available_copies: 1, total_stock: 2, mode: "offline", cover_url: "https://m.media-amazon.com/images/I/81Pz-0oX9XL.jpg" },
        { id: memory.nextBookId++, title: "The Alchemist", author: "Paulo Coelho", category: "Fiction", available_copies: 4, total_stock: 5, mode: "online", cover_url: "https://m.media-amazon.com/images/I/810u9MFEK8L.jpg" }
    ];

    memory.borrowRequests = [
        {
            id: memory.nextRequestId++,
            book_id: 1,
            member_id: 2,
            title: "The Hobbit",
            member_name: "Student User",
            days_requested: 7,
            status: "Pending",
            due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
        }
    ];

    memory.fines = [
        { id: memory.nextFineId++, member_id: 2, member_name: "Student User", amount: 50, reason: "Late return", status: "unpaid" }
    ];
}

async function findUserByEmail(email) {
    if (usingDatabase) {
        const [rows] = await pool.query("SELECT * FROM members WHERE email = ?", [email]);
        const user = rows[0];
        return user
            ? {
                id: user.member_id,
                member_id: user.member_id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                password: user.password,
                role: normalizeRole(user.role)
            }
            : null;
    }

    return memory.users.find((user) => user.email === email) || null;
}

async function registerUser({ name, phone, email, password, role }) {
    const safeRole = normalizeRole(role);
    const hashedPassword = await bcrypt.hash(password, 10);

    if (usingDatabase) {
        const [result] = await pool.query(
            `INSERT INTO members (name, phone, email, password, role, joined_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_DATE)`,
            [name, phone, email, hashedPassword, safeRole]
        );
        return {
            id: result.insertId,
            name,
            phone,
            email,
            role: safeRole
        };
    }

    const user = {
        id: memory.nextUserId++,
        name,
        phone,
        email,
        password: hashedPassword,
        role: safeRole
    };
    memory.users.push(user);
    return user;
}

async function getBooks(search = "") {
    if (usingDatabase) {
        const query = `%${search}%`;
        const [rows] = await pool.query(
            `SELECT
                book_id AS id, title, author, category,
                available_copies, total_stock, mode, cover_url
             FROM books
             WHERE title LIKE ? OR author LIKE ? OR category LIKE ?
             ORDER BY book_id DESC`,
            [query, query, query]
        );
        return rows;
    }

    const query = search.toLowerCase();
    return memory.books.filter((book) => {
        return [book.title, book.author, book.category].some((value) =>
            String(value || "").toLowerCase().includes(query)
        );
    });
}

async function getBorrowRequests(memberId = null) {
    if (usingDatabase) {
        const params = [];
        let where = "";
        if (memberId) {
            where = "WHERE i.member_id = ?";
            params.push(memberId);
        }

        const [rows] = await pool.query(
            `SELECT
                i.issue_id AS id,
                i.book_id,
                i.member_id,
                m.name AS member_name,
                b.title,
                i.days_requested,
                i.status,
                i.issue_date,
                i.due_date
             FROM issued_books i
             JOIN members m ON m.member_id = i.member_id
             JOIN books b ON b.book_id = i.book_id
             ${where}
             ORDER BY i.issue_id DESC`,
            params
        );
        return rows;
    }

    return memberId
        ? memory.borrowRequests.filter((request) => request.member_id === memberId)
        : memory.borrowRequests;
}

async function getMembers() {
    if (usingDatabase) {
        const [rows] = await pool.query(
            `SELECT
                member_id AS id, name, phone, email, role, joined_at
             FROM members
             ORDER BY member_id DESC`
        );
        return rows;
    }

    return memory.users.map(publicUser);
}

async function getFines(memberId = null) {
    if (usingDatabase) {
        const params = [];
        let where = "";
        if (memberId) {
            where = "WHERE f.member_id = ?";
            params.push(memberId);
        }

        const [rows] = await pool.query(
            `SELECT
                f.fine_id AS id,
                f.member_id,
                m.name AS member_name,
                f.amount,
                f.reason,
                f.status
             FROM fines f
             JOIN members m ON m.member_id = f.member_id
             ${where}
             ORDER BY f.fine_id DESC`,
            params
        );
        return rows;
    }

    return memberId ? memory.fines.filter((fine) => fine.member_id === memberId) : memory.fines;
}

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        database: usingDatabase ? "mysql" : "memory",
        message: usingDatabase ? "Backend and MySQL are connected" : "Backend running with sample memory data"
    });
});

app.post(["/login", "/api/auth/login"], async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ ok: false, message: "Email and password are required" });
        }

        const user = await findUserByEmail(email);
        const passwordMatches = user ? await comparePassword(password, user.password) : false;

        if (!user || !passwordMatches) {
            return res.status(401).json({ ok: false, message: "Invalid email or password" });
        }

        req.session.user = publicUser(user);

        return res.json({
            ok: true,
            user: req.session.user,
            redirect: getRedirectForRole(req.session.user.role)
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Login failed", error: error.message });
    }
});

app.post(["/register", "/api/auth/register"], async (req, res) => {
    try {
        const { name, phone, email, password, role } = req.body;

        if (!name || !phone || !email || !password) {
            return res.status(400).json({ ok: false, message: "All fields are required" });
        }

        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({ ok: false, message: "Email already registered" });
        }

        const user = await registerUser({ name, phone, email, password, role });
        req.session.user = publicUser(user);

        return res.status(201).json({
            ok: true,
            message: "Registration successful",
            user: req.session.user,
            redirect: getRedirectForRole(req.session.user.role)
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Registration failed", error: error.message });
    }
});

app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ ok: true, redirect: "/login/login.html" });
    });
});

app.get("/api/me", requireLogin, (req, res) => {
    res.json({ ok: true, user: req.session.user });
});

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
        const [books, requests, members, fines] = await Promise.all([
            getBooks(),
            getBorrowRequests(),
            getMembers(),
            getFines()
        ]);

        const today = new Date().toISOString().slice(0, 10);
        const pendingRequests = requests.filter((request) => request.status === "Pending");
        const overdueCount = requests.filter((request) => {
            return request.status === "Granted" && request.due_date && request.due_date < today;
        }).length;

        res.json({
            ok: true,
            stats: {
                totalBooks: books.length,
                totalMembers: members.filter((member) => normalizeRole(member.role) === "member").length,
                pendingRequests: pendingRequests.length,
                overdueCount
            },
            books,
            requests,
            members,
            fines
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not load dashboard", error: error.message });
    }
});

app.get("/api/student/dashboard", requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const [books, requests, fines] = await Promise.all([
            getBooks(),
            getBorrowRequests(userId),
            getFines(userId)
        ]);

        res.json({
            ok: true,
            user: req.session.user,
            books,
            requests,
            fines,
            totalFine: fines
                .filter((fine) => fine.status === "unpaid")
                .reduce((sum, fine) => sum + Number(fine.amount), 0)
        });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not load student dashboard", error: error.message });
    }
});

app.get("/api/books", requireLogin, async (req, res) => {
    try {
        const books = await getBooks(req.query.search || "");
        res.json({ ok: true, books });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not load books", error: error.message });
    }
});

app.post("/api/books", requireAdmin, async (req, res) => {
    try {
        const {
            title,
            author,
            category,
            available_copies = 1,
            total_stock = available_copies,
            mode = "offline",
            cover_url = ""
        } = req.body;

        if (!title) {
            return res.status(400).json({ ok: false, message: "Book title is required" });
        }

        if (usingDatabase) {
            const [result] = await pool.query(
                `INSERT INTO books
                    (title, author, category, available_copies, total_stock, mode, cover_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [title, author || "", category || "", available_copies, total_stock, mode, cover_url]
            );
            return res.status(201).json({ ok: true, id: result.insertId, message: "Book added" });
        }

        const book = {
            id: memory.nextBookId++,
            title,
            author: author || "",
            category: category || "",
            available_copies: Number(available_copies),
            total_stock: Number(total_stock),
            mode,
            cover_url
        };
        memory.books.push(book);
        res.status(201).json({ ok: true, id: book.id, message: "Book added" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not add book", error: error.message });
    }
});

app.put("/api/books/:id", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { title, author, category, available_copies, total_stock, mode, cover_url } = req.body;

        if (usingDatabase) {
            await pool.query(
                `UPDATE books
                 SET title = ?, author = ?, category = ?, available_copies = ?,
                     total_stock = ?, mode = ?, cover_url = ?
                 WHERE book_id = ?`,
                [title, author, category, available_copies, total_stock, mode, cover_url, id]
            );
            return res.json({ ok: true, message: "Book updated" });
        }

        const book = memory.books.find((item) => item.id === id);
        if (!book) return res.status(404).json({ ok: false, message: "Book not found" });
        Object.assign(book, { title, author, category, available_copies, total_stock, mode, cover_url });
        res.json({ ok: true, message: "Book updated" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not update book", error: error.message });
    }
});

app.delete("/api/books/:id", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (usingDatabase) {
            await pool.query("DELETE FROM books WHERE book_id = ?", [id]);
            return res.json({ ok: true, message: "Book deleted" });
        }

        memory.books = memory.books.filter((book) => book.id !== id);
        res.json({ ok: true, message: "Book deleted" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not delete book", error: error.message });
    }
});

app.get("/api/borrow-requests", requireAdmin, async (req, res) => {
    try {
        const requests = await getBorrowRequests();
        res.json({ ok: true, requests });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not load requests", error: error.message });
    }
});

app.post("/api/borrow-requests", requireLogin, async (req, res) => {
    try {
        const { book_id, days_requested = 7 } = req.body;
        const userId = req.session.user.id;

        if (!book_id) {
            return res.status(400).json({ ok: false, message: "Book is required" });
        }

        if (usingDatabase) {
            await pool.query(
                `INSERT INTO issued_books
                    (book_id, member_id, issue_date, days_requested, status, due_date)
                 VALUES (?, ?, CURRENT_DATE, ?, 'Pending', DATE_ADD(CURRENT_DATE, INTERVAL ? DAY))`,
                [book_id, userId, days_requested, days_requested]
            );
            return res.status(201).json({ ok: true, message: "Borrow request submitted" });
        }

        const book = memory.books.find((item) => item.id === Number(book_id));
        memory.borrowRequests.push({
            id: memory.nextRequestId++,
            book_id: Number(book_id),
            member_id: userId,
            title: book ? book.title : "Unknown Book",
            member_name: req.session.user.name,
            days_requested: Number(days_requested),
            status: "Pending",
            due_date: new Date(Date.now() + Number(days_requested) * 86400000).toISOString().slice(0, 10)
        });
        res.status(201).json({ ok: true, message: "Borrow request submitted" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not submit request", error: error.message });
    }
});

app.patch("/api/borrow-requests/:id/status", requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { status } = req.body;
        const allowedStatuses = ["Pending", "Granted", "Rejected", "returned"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ ok: false, message: "Invalid status" });
        }

        if (usingDatabase) {
            await pool.query("UPDATE issued_books SET status = ? WHERE issue_id = ?", [status, id]);
            if (status === "Granted") {
                await pool.query(
                    `UPDATE books b
                     JOIN issued_books i ON i.book_id = b.book_id
                     SET b.available_copies = GREATEST(b.available_copies - 1, 0)
                     WHERE i.issue_id = ?`,
                    [id]
                );
            }
            return res.json({ ok: true, message: "Request updated" });
        }

        const request = memory.borrowRequests.find((item) => item.id === id);
        if (!request) return res.status(404).json({ ok: false, message: "Request not found" });
        request.status = status;
        if (status === "Granted") {
            const book = memory.books.find((item) => item.id === request.book_id);
            if (book) book.available_copies = Math.max(book.available_copies - 1, 0);
        }
        res.json({ ok: true, message: "Request updated" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not update request", error: error.message });
    }
});

app.get("/api/google-books", requireLogin, async (req, res) => {
    try {
        const query = req.query.q || "library science";
        const response = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`
        );

        if (!response.ok) {
            return res.json({
                ok: true,
                source: "sample",
                message: "Google Books API unavailable, showing demo results",
                books: sampleGoogleBooks(query)
            });
        }

        const data = await response.json();
        const books = (data.items || []).map((item) => {
            const info = item.volumeInfo || {};
            return {
                google_id: item.id,
                title: info.title || "Untitled",
                author: (info.authors || []).join(", "),
                category: (info.categories || ["General"])[0],
                cover_url: info.imageLinks ? info.imageLinks.thumbnail : ""
            };
        });

        res.json({ ok: true, source: "google", books: books.length ? books : sampleGoogleBooks(query) });
    } catch (error) {
        res.json({
            ok: true,
            source: "sample",
            message: "Google Books API unavailable, showing demo results",
            books: sampleGoogleBooks(req.query.q || "library science")
        });
    }
});

connectDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`CircuLib backend running at http://localhost:${PORT}`);
        console.log(`Demo login: admin@gmail.com / 1234`);
        console.log(`Demo login: student@gmail.com / 1234`);
    });
});
