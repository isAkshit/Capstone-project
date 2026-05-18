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
    libraries: [],
    books: [],
    borrowRequests: [],
    fines: [],
    nextUserId: 1,
    nextLibraryId: 1,
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
        role: normalizeRole(user.role),
        library_id: user.library_id || null,
        library_code: user.library_code || ""
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

function httpsUrl(value = "") {
    return String(value || "").replace(/^http:\/\//i, "https://");
}

function cleanBookMatchValue(value = "") {
    return String(value || "").trim().toLowerCase();
}

function cleanStockCount(value, fallback = 1) {
    const count = Number.parseInt(value, 10);
    if (!Number.isFinite(count) || count < 1) return fallback;
    return Math.min(count, 999);
}

function normalizeLibraryCode(value = "") {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "-")
        .toUpperCase();
}

function isValidLibraryCode(value = "") {
    return /^[A-Z0-9_-]{3,30}$/.test(normalizeLibraryCode(value));
}

async function fetchJsonFromUrl(url, sourceName) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal,
            headers: {
                "Accept": "application/json",
                "User-Agent": "CircuLib/1.0"
            }
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(`${sourceName} returned ${response.status}: ${errorBody.slice(0, 120)}`);
        }

        return response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeGoogleBooks(data) {
    return (data.items || [])
        .map((item) => {
            const info = item.volumeInfo || {};

            return {
                google_id: item.id,
                title: info.title || "Untitled",
                author: (info.authors || []).join(", "),
                category: (info.categories || ["General"])[0],
                cover_url: httpsUrl(
                    info.imageLinks?.thumbnail ||
                    info.imageLinks?.smallThumbnail ||
                    ""
                )
            };
        })
        .filter((book) => book.title && book.title !== "Untitled");
}

function normalizeOpenLibraryBooks(data) {
    return (data.docs || [])
        .map((item) => {
            const coverUrl = item.cover_i
                ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg`
                : "";

            return {
                google_id: item.key || `openlibrary-${item.title}`,
                title: item.title || "Untitled",
                author: (item.author_name || []).slice(0, 3).join(", "),
                category: (item.subject || ["General"])[0],
                cover_url: coverUrl
            };
        })
        .filter((book) => book.title && book.title !== "Untitled");
}

async function searchGoogleBooksApi(query) {
    const data = await fetchJsonFromUrl(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`,
        "Google Books"
    );
    return normalizeGoogleBooks(data);
}

async function searchOpenLibraryApi(query) {
    const fields = "key,title,author_name,subject,cover_i";
    const data = await fetchJsonFromUrl(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${fields}`,
        "Open Library"
    );
    return normalizeOpenLibraryBooks(data);
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
            library_id INT,
            joined_at DATE DEFAULT (CURRENT_DATE)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS libraries (
            library_id INT AUTO_INCREMENT PRIMARY KEY,
            library_name VARCHAR(100) NOT NULL,
            library_code VARCHAR(30) NOT NULL UNIQUE,
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

async function columnExists(tableName, columnName) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbConfig.database, tableName, columnName]
    );
    return rows.length > 0;
}

async function ensureSchemaColumns() {
    if (!(await columnExists("libraries", "library_code"))) {
        await pool.query("ALTER TABLE libraries ADD COLUMN library_code VARCHAR(30)");
    }

    if (!(await columnExists("members", "library_id"))) {
        await pool.query("ALTER TABLE members ADD COLUMN library_id INT");
    }

    await pool.query(
        `UPDATE libraries
         SET library_code = CONCAT('LIB', library_id)
         WHERE library_code IS NULL OR TRIM(library_code) = ''`
    );

    await pool.query("ALTER TABLE libraries MODIFY library_code VARCHAR(30) NOT NULL");

    const [indexes] = await pool.query(
        `SELECT INDEX_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'libraries' AND INDEX_NAME = 'library_code_unique'`,
        [dbConfig.database]
    );

    if (!indexes.length) {
        await pool.query("ALTER TABLE libraries ADD UNIQUE KEY library_code_unique (library_code)");
    }
}

async function migrateExistingLibraryData() {
    const [[library]] = await pool.query("SELECT library_id FROM libraries WHERE library_code = ? LIMIT 1", ["CIRCULIB"]);
    let libraryId = library ? library.library_id : null;

    if (!libraryId) {
        const [[admin]] = await pool.query("SELECT member_id FROM members WHERE role = 'admin' ORDER BY member_id ASC LIMIT 1");
        const [result] = await pool.query(
            "INSERT INTO libraries (library_name, library_code, admin_id) VALUES (?, ?, ?)",
            ["CircuLib Central Library", "CIRCULIB", admin ? admin.member_id : null]
        );
        libraryId = result.insertId;
    }

    await pool.query(
        "UPDATE members SET library_id = ?, phone = ? WHERE library_id IS NULL OR library_id = 0",
        [libraryId, "CIRCULIB"]
    );

    await pool.query(
        "UPDATE books SET library_id = ? WHERE library_id IS NULL OR library_id = 0",
        [libraryId]
    );
}

async function seedDatabase() {
    const adminPassword = await bcrypt.hash("1234", 10);
    const memberPassword = await bcrypt.hash("1234", 10);

    await pool.query(
        `INSERT IGNORE INTO members (name, phone, email, password, role, joined_at)
         VALUES
         ('Admin User', 'CIRCULIB', 'admin@gmail.com', ?, 'admin', CURRENT_DATE),
         ('Student User', 'CIRCULIB', 'student@gmail.com', ?, 'member', CURRENT_DATE)`,
        [adminPassword, memberPassword]
    );

    const [[library]] = await pool.query("SELECT library_id FROM libraries WHERE library_code = ? LIMIT 1", ["CIRCULIB"]);
    let libraryId = library ? library.library_id : null;

    if (!libraryId) {
        const [[admin]] = await pool.query("SELECT member_id FROM members WHERE role = 'admin' LIMIT 1");
        const [result] = await pool.query(
            "INSERT INTO libraries (library_name, library_code, admin_id) VALUES (?, ?, ?)",
            ["CircuLib Central Library", "CIRCULIB", admin.member_id]
        );
        libraryId = result.insertId;
    }

    await pool.query(
        "UPDATE members SET library_id = ?, phone = ? WHERE email IN (?, ?) AND (library_id IS NULL OR library_id = 0)",
        [libraryId, "CIRCULIB", "admin@gmail.com", "student@gmail.com"]
    );

   const [existingBooks] = await pool.query(
    "SELECT book_id FROM books WHERE title = ? AND library_id = ? LIMIT 1",
    ["The Hobbit", libraryId]
);

if (existingBooks.length === 0) {
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
        await ensureSchemaColumns();
        await seedDatabase();
        await migrateExistingLibraryData();
        await consolidateDuplicateBooks();
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
    const libraryId = memory.nextLibraryId++;

    memory.libraries = [
        {
            id: libraryId,
            library_id: libraryId,
            library_name: "CircuLib Central Library",
            library_code: "CIRCULIB",
            admin_id: 1
        }
    ];

    memory.users = [
        {
            id: memory.nextUserId++,
            name: "Admin User",
            phone: "CIRCULIB",
            email: "admin@gmail.com",
            password: adminPassword,
            role: "admin",
            library_id: libraryId,
            library_code: "CIRCULIB"
        },
        {
            id: memory.nextUserId++,
            name: "Student User",
            phone: "CIRCULIB",
            email: "student@gmail.com",
            password: memberPassword,
            role: "member",
            library_id: libraryId,
            library_code: "CIRCULIB"
        }
    ];

    memory.books = [
        { id: memory.nextBookId++, title: "The Hobbit", author: "J.R.R. Tolkien", category: "Fantasy", available_copies: 3, total_stock: 4, mode: "offline", library_id: libraryId, cover_url: "https://m.media-amazon.com/images/I/7108sdE9u+L.jpg" },
        { id: memory.nextBookId++, title: "1984", author: "George Orwell", category: "Dystopian", available_copies: 2, total_stock: 3, mode: "offline", library_id: libraryId, cover_url: "https://m.media-amazon.com/images/I/71kxa1-0mfL.jpg" },
        { id: memory.nextBookId++, title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", available_copies: 1, total_stock: 2, mode: "offline", library_id: libraryId, cover_url: "https://m.media-amazon.com/images/I/81Pz-0oX9XL.jpg" },
        { id: memory.nextBookId++, title: "The Alchemist", author: "Paulo Coelho", category: "Fiction", available_copies: 4, total_stock: 5, mode: "online", library_id: libraryId, cover_url: "https://m.media-amazon.com/images/I/810u9MFEK8L.jpg" }
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

    consolidateMemoryBooks();
}

async function consolidateDuplicateBooks() {
    if (!pool) return;

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [books] = await connection.query(
            `SELECT book_id, title, author, category, available_copies, total_stock, mode, cover_url
             FROM books
             ORDER BY book_id ASC
             FOR UPDATE`
        );

        const groups = new Map();
        books.forEach((book) => {
            const key = `${book.library_id || "none"}|${cleanBookMatchValue(book.title)}|${cleanBookMatchValue(book.author)}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(book);
        });

        for (const group of groups.values()) {
            if (group.length < 2) continue;

            const primary = group[0];
            const duplicates = group.slice(1);
            const duplicateIds = duplicates.map((book) => book.book_id);
            const available = group.reduce((sum, book) => sum + Number(book.available_copies || 0), 0);
            const stock = group.reduce((sum, book) => sum + Number(book.total_stock || 0), 0);
            const category = group.find((book) => book.category)?.category || "";
            const coverUrl = group.find((book) => book.cover_url)?.cover_url || "";
            const mode = group.find((book) => book.mode === "online") ? "online" : primary.mode;

            await connection.query(
                "UPDATE issued_books SET book_id = ? WHERE book_id IN (?)",
                [primary.book_id, duplicateIds]
            );

            await connection.query(
                `UPDATE books
                 SET available_copies = ?, total_stock = ?, category = ?, mode = ?, cover_url = ?
                 WHERE book_id = ?`,
                [available, stock, category, mode, coverUrl, primary.book_id]
            );

            await connection.query("DELETE FROM books WHERE book_id IN (?)", [duplicateIds]);
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

function consolidateMemoryBooks() {
    const booksByKey = new Map();
    const mergedBooks = [];
    const replacedIds = new Map();

    memory.books.forEach((book) => {
        const key = `${book.library_id || "none"}|${cleanBookMatchValue(book.title)}|${cleanBookMatchValue(book.author)}`;
        const existingBook = booksByKey.get(key);

        if (!existingBook) {
            booksByKey.set(key, book);
            mergedBooks.push(book);
            return;
        }

        existingBook.available_copies = Number(existingBook.available_copies || 0) + Number(book.available_copies || 0);
        existingBook.total_stock = Number(existingBook.total_stock || 0) + Number(book.total_stock || 0);
        if (!existingBook.category && book.category) existingBook.category = book.category;
        if (!existingBook.cover_url && book.cover_url) existingBook.cover_url = book.cover_url;
        replacedIds.set(book.id, existingBook.id);
    });

    memory.borrowRequests.forEach((request) => {
        if (replacedIds.has(request.book_id)) {
            request.book_id = replacedIds.get(request.book_id);
        }
    });

    memory.books = mergedBooks;
}

async function findUserByEmail(email) {
    if (usingDatabase) {
        const [rows] = await pool.query(
            `SELECT m.*, l.library_code
             FROM members m
             LEFT JOIN libraries l ON l.library_id = m.library_id
             WHERE m.email = ?`,
            [email]
        );
        const user = rows[0];
        return user
            ? {
                id: user.member_id,
                member_id: user.member_id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                password: user.password,
                role: normalizeRole(user.role),
                library_id: user.library_id,
                library_code: user.library_code || ""
            }
            : null;
    }

    return memory.users.find((user) => user.email === email) || null;
}

async function registerUser({ name, libraryCode, email, password, role }) {
    const safeRole = normalizeRole(role);
    const hashedPassword = await bcrypt.hash(password, 10);
    const safeLibraryCode = normalizeLibraryCode(libraryCode);

    if (usingDatabase) {
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            if (safeRole === "admin") {
                const [existingLibraries] = await connection.query(
                    "SELECT library_id FROM libraries WHERE library_code = ?",
                    [safeLibraryCode]
                );

                if (existingLibraries.length) {
                    const error = new Error("Library code already exists");
                    error.statusCode = 409;
                    throw error;
                }

                const [memberResult] = await connection.query(
                    `INSERT INTO members (name, phone, email, password, role, joined_at)
                     VALUES (?, ?, ?, ?, ?, CURRENT_DATE)`,
                    [name, safeLibraryCode, email, hashedPassword, safeRole]
                );

                const [libraryResult] = await connection.query(
                    "INSERT INTO libraries (library_name, library_code, admin_id) VALUES (?, ?, ?)",
                    [`${name}'s Library`, safeLibraryCode, memberResult.insertId]
                );

                await connection.query(
                    "UPDATE members SET library_id = ? WHERE member_id = ?",
                    [libraryResult.insertId, memberResult.insertId]
                );

                await connection.commit();
                return {
                    id: memberResult.insertId,
                    member_id: memberResult.insertId,
                    name,
                    phone: safeLibraryCode,
                    email,
                    role: safeRole,
                    library_id: libraryResult.insertId,
                    library_code: safeLibraryCode
                };
            }

            const [libraries] = await connection.query(
                "SELECT library_id, library_code FROM libraries WHERE library_code = ?",
                [safeLibraryCode]
            );

            if (!libraries.length) {
                const error = new Error("Library code not found");
                error.statusCode = 404;
                throw error;
            }

            const library = libraries[0];
            const [result] = await connection.query(
                `INSERT INTO members (name, phone, email, password, role, library_id, joined_at)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE)`,
                [name, safeLibraryCode, email, hashedPassword, safeRole, library.library_id]
            );

            await connection.commit();
            return {
                id: result.insertId,
                member_id: result.insertId,
                name,
                phone: safeLibraryCode,
                email,
                role: safeRole,
                library_id: library.library_id,
                library_code: library.library_code
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    if (safeRole === "admin") {
        if (memory.libraries.some((library) => library.library_code === safeLibraryCode)) {
            const error = new Error("Library code already exists");
            error.statusCode = 409;
            throw error;
        }

        const userId = memory.nextUserId++;
        const libraryId = memory.nextLibraryId++;
        const user = {
            id: userId,
            name,
            phone: safeLibraryCode,
            email,
            password: hashedPassword,
            role: safeRole,
            library_id: libraryId,
            library_code: safeLibraryCode
        };

        memory.libraries.push({
            id: libraryId,
            library_id: libraryId,
            library_name: `${name}'s Library`,
            library_code: safeLibraryCode,
            admin_id: userId
        });
        memory.users.push(user);
        return user;
    }

    const library = memory.libraries.find((item) => item.library_code === safeLibraryCode);
    if (!library) {
        const error = new Error("Library code not found");
        error.statusCode = 404;
        throw error;
    }

    const user = {
        id: memory.nextUserId++,
        name,
        phone: safeLibraryCode,
        email,
        password: hashedPassword,
        role: safeRole,
        library_id: library.library_id || library.id,
        library_code: library.library_code
    };
    memory.users.push(user);
    return user;
}

async function getBooks(search = "", libraryId = null) {
    if (usingDatabase) {
        const query = `%${search}%`;
        const params = libraryId
            ? [libraryId, query, query, query]
            : [query, query, query];
        const [rows] = await pool.query(
            `SELECT
                book_id AS id, title, author, category,
                available_copies, total_stock, mode, library_id, cover_url
             FROM books
             WHERE ${libraryId ? "library_id = ? AND" : ""} (title LIKE ? OR author LIKE ? OR category LIKE ?)
             ORDER BY book_id DESC`,
            params
        );
        return rows;
    }

    const query = search.toLowerCase();
    return memory.books.filter((book) => {
        if (libraryId && Number(book.library_id) !== Number(libraryId)) return false;
        return [book.title, book.author, book.category].some((value) =>
            String(value || "").toLowerCase().includes(query)
        );
    });
}

async function getBorrowRequests(memberId = null, libraryId = null) {
    if (usingDatabase) {
        const params = [];
        const whereParts = [];
        if (memberId) {
            whereParts.push("i.member_id = ?");
            params.push(memberId);
        }
        if (libraryId) {
            whereParts.push("b.library_id = ?");
            params.push(libraryId);
        }
        const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

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

    return memory.borrowRequests.filter((request) => {
        if (memberId && Number(request.member_id) !== Number(memberId)) return false;
        if (libraryId) {
            const book = memory.books.find((item) => Number(item.id) === Number(request.book_id));
            if (!book || Number(book.library_id) !== Number(libraryId)) return false;
        }
        return true;
    });
}

async function getMembers(libraryId = null) {
    if (usingDatabase) {
        const params = libraryId ? [libraryId] : [];
        const [rows] = await pool.query(
            `SELECT
                member_id AS id, name, phone, email, role, library_id, joined_at
             FROM members
             ${libraryId ? "WHERE library_id = ?" : ""}
             ORDER BY member_id DESC`
            ,
            params
        );
        return rows;
    }

    return memory.users
        .filter((user) => !libraryId || Number(user.library_id) === Number(libraryId))
        .map(publicUser);
}

async function getFines(memberId = null, libraryId = null) {
    if (usingDatabase) {
        const params = [];
        const whereParts = [];
        if (memberId) {
            whereParts.push("f.member_id = ?");
            params.push(memberId);
        }
        if (libraryId) {
            whereParts.push("m.library_id = ?");
            params.push(libraryId);
        }
        const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

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

    return memory.fines.filter((fine) => {
        if (memberId && Number(fine.member_id) !== Number(memberId)) return false;
        if (libraryId) {
            const member = memory.users.find((user) => Number(user.id) === Number(fine.member_id));
            if (!member || Number(member.library_id) !== Number(libraryId)) return false;
        }
        return true;
    });
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
        const { name, email, password, role } = req.body;
        const libraryCode = req.body.libraryCode || req.body.library_code;
        const safeRole = normalizeRole(role);

        if (!name || !libraryCode || !email || !password) {
            return res.status(400).json({ ok: false, message: "All fields are required" });
        }

        if (!isValidLibraryCode(libraryCode)) {
            return res.status(400).json({
                ok: false,
                message: "Library code must be 3-30 letters, numbers, dashes, or underscores"
            });
        }

        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            return res.status(409).json({ ok: false, message: "Email already registered" });
        }

        const user = await registerUser({ name, libraryCode, email, password, role: safeRole });
        req.session.user = publicUser(user);

        return res.status(201).json({
            ok: true,
            message: "Registration successful",
            user: req.session.user,
            redirect: getRedirectForRole(req.session.user.role)
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ ok: false, message: error.message || "Registration failed" });
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
        const libraryId = req.session.user.library_id;
        const [books, requests, members, fines] = await Promise.all([
            getBooks("", libraryId),
            getBorrowRequests(null, libraryId),
            getMembers(libraryId),
            getFines(null, libraryId)
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
        const libraryId = req.session.user.library_id;
        const [books, requests, fines] = await Promise.all([
            getBooks("", libraryId),
            getBorrowRequests(userId, libraryId),
            getFines(userId, libraryId)
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
        const books = await getBooks(req.query.search || "", req.session.user.library_id);
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
            total_stock,
            mode = "offline",
            cover_url = ""
        } = req.body;

        if (!title) {
            return res.status(400).json({ ok: false, message: "Book title is required" });
        }

        const copiesToAdd = cleanStockCount(available_copies);
        const stockToAdd = cleanStockCount(total_stock, copiesToAdd);
        const safeTitle = String(title).trim();
        const safeAuthor = String(author || "").trim();
        const safeCategory = String(category || "").trim();
        const safeCoverUrl = String(cover_url || "").trim();
        const libraryId = req.session.user.library_id;

        if (!libraryId) {
            return res.status(400).json({ ok: false, message: "Your account is not linked to a library" });
        }

        if (usingDatabase) {
            const connection = await pool.getConnection();

            try {
                await connection.beginTransaction();

                const [matches] = await connection.query(
                    `SELECT book_id, available_copies, total_stock
                     FROM books
                     WHERE library_id = ?
                       AND LOWER(TRIM(title)) = LOWER(TRIM(?))
                       AND LOWER(TRIM(COALESCE(author, ''))) = LOWER(TRIM(?))
                     ORDER BY book_id ASC
                     FOR UPDATE`,
                    [libraryId, safeTitle, safeAuthor]
                );

                if (matches.length) {
                    const primaryBook = matches[0];
                    const duplicateIds = matches.slice(1).map((book) => book.book_id);
                    const currentAvailable = matches.reduce((sum, book) => sum + Number(book.available_copies || 0), 0);
                    const currentStock = matches.reduce((sum, book) => sum + Number(book.total_stock || 0), 0);

                    if (duplicateIds.length) {
                        await connection.query(
                            "UPDATE issued_books SET book_id = ? WHERE book_id IN (?)",
                            [primaryBook.book_id, duplicateIds]
                        );
                        await connection.query("DELETE FROM books WHERE book_id IN (?)", [duplicateIds]);
                    }

                    await connection.query(
                        `UPDATE books
                         SET title = ?, author = ?, category = ?,
                             available_copies = ?, total_stock = ?,
                             mode = ?, cover_url = ?
                         WHERE book_id = ?`,
                        [
                            safeTitle,
                            safeAuthor,
                            safeCategory,
                            currentAvailable + copiesToAdd,
                            currentStock + stockToAdd,
                            mode,
                            safeCoverUrl,
                            primaryBook.book_id
                        ]
                    );

                    await connection.commit();
                    return res.json({ ok: true, id: primaryBook.book_id, message: "Book stock updated" });
                }

                const [result] = await connection.query(
                    `INSERT INTO books
                        (title, author, category, available_copies, total_stock, mode, library_id, cover_url)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [safeTitle, safeAuthor, safeCategory, copiesToAdd, stockToAdd, mode, libraryId, safeCoverUrl]
                );

                await connection.commit();
                return res.status(201).json({ ok: true, id: result.insertId, message: "Book added" });
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        }

        const existingBook = memory.books.find((book) => {
            if (Number(book.library_id) !== Number(libraryId)) return false;
            return cleanBookMatchValue(book.title) === cleanBookMatchValue(safeTitle) &&
                cleanBookMatchValue(book.author) === cleanBookMatchValue(safeAuthor);
        });

        if (existingBook) {
            existingBook.title = safeTitle;
            existingBook.author = safeAuthor;
            existingBook.category = safeCategory;
            existingBook.available_copies = Number(existingBook.available_copies || 0) + copiesToAdd;
            existingBook.total_stock = Number(existingBook.total_stock || 0) + stockToAdd;
            existingBook.mode = mode;
            existingBook.cover_url = safeCoverUrl;
            return res.json({ ok: true, id: existingBook.id, message: "Book stock updated" });
        }

        const book = {
            id: memory.nextBookId++,
            title: safeTitle,
            author: safeAuthor,
            category: safeCategory,
            available_copies: copiesToAdd,
            total_stock: stockToAdd,
            mode,
            library_id: libraryId,
            cover_url: safeCoverUrl
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
        const libraryId = req.session.user.library_id;

        if (usingDatabase) {
            const [result] = await pool.query(
                `UPDATE books
                 SET title = ?, author = ?, category = ?, available_copies = ?,
                     total_stock = ?, mode = ?, cover_url = ?
                 WHERE book_id = ? AND library_id = ?`,
                [title, author, category, available_copies, total_stock, mode, cover_url, id, libraryId]
            );
            if (!result.affectedRows) {
                return res.status(404).json({ ok: false, message: "Book not found in your library" });
            }
            return res.json({ ok: true, message: "Book updated" });
        }

        const book = memory.books.find((item) => item.id === id && Number(item.library_id) === Number(libraryId));
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
        const libraryId = req.session.user.library_id;

        if (usingDatabase) {
            const [result] = await pool.query("DELETE FROM books WHERE book_id = ? AND library_id = ?", [id, libraryId]);
            if (!result.affectedRows) {
                return res.status(404).json({ ok: false, message: "Book not found in your library" });
            }
            return res.json({ ok: true, message: "Book deleted" });
        }

        const beforeCount = memory.books.length;
        memory.books = memory.books.filter((book) => {
            return !(book.id === id && Number(book.library_id) === Number(libraryId));
        });
        if (memory.books.length === beforeCount) {
            return res.status(404).json({ ok: false, message: "Book not found" });
        }
        res.json({ ok: true, message: "Book deleted" });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not delete book", error: error.message });
    }
});

app.get("/api/borrow-requests", requireAdmin, async (req, res) => {
    try {
        const requests = await getBorrowRequests(null, req.session.user.library_id);
        res.json({ ok: true, requests });
    } catch (error) {
        res.status(500).json({ ok: false, message: "Could not load requests", error: error.message });
    }
});

app.post("/api/borrow-requests", requireLogin, async (req, res) => {
    try {
        const { book_id, days_requested = 7 } = req.body;
        const userId = req.session.user.id;
        const libraryId = req.session.user.library_id;

        if (!book_id) {
            return res.status(400).json({ ok: false, message: "Book is required" });
        }

        if (usingDatabase) {
            const [books] = await pool.query(
                "SELECT book_id FROM books WHERE book_id = ? AND library_id = ?",
                [book_id, libraryId]
            );

            if (!books.length) {
                return res.status(404).json({ ok: false, message: "Book not found in your library" });
            }

            await pool.query(
                `INSERT INTO issued_books
                    (book_id, member_id, issue_date, days_requested, status, due_date)
                 VALUES (?, ?, CURRENT_DATE, ?, 'Pending', DATE_ADD(CURRENT_DATE, INTERVAL ? DAY))`,
                [book_id, userId, days_requested, days_requested]
            );
            return res.status(201).json({ ok: true, message: "Borrow request submitted" });
        }

        const book = memory.books.find((item) => {
            return item.id === Number(book_id) && Number(item.library_id) === Number(libraryId);
        });
        if (!book) {
            return res.status(404).json({ ok: false, message: "Book not found in your library" });
        }
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
        const libraryId = req.session.user.library_id;
        const allowedStatuses = ["Pending", "Granted", "Rejected", "returned"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ ok: false, message: "Invalid status" });
        }

        if (usingDatabase) {
            const [result] = await pool.query(
                `UPDATE issued_books i
                 JOIN books b ON b.book_id = i.book_id
                 SET i.status = ?
                 WHERE i.issue_id = ? AND b.library_id = ?`,
                [status, id, libraryId]
            );
            if (!result.affectedRows) {
                return res.status(404).json({ ok: false, message: "Request not found in your library" });
            }
            if (status === "Granted") {
                await pool.query(
                    `UPDATE books b
                     JOIN issued_books i ON i.book_id = b.book_id
                     SET b.available_copies = GREATEST(b.available_copies - 1, 0)
                     WHERE i.issue_id = ? AND b.library_id = ?`,
                    [id, libraryId]
                );
            }
            return res.json({ ok: true, message: "Request updated" });
        }

        const request = memory.borrowRequests.find((item) => item.id === id);
        if (!request) return res.status(404).json({ ok: false, message: "Request not found" });
        const requestBook = memory.books.find((item) => Number(item.id) === Number(request.book_id));
        if (!requestBook || Number(requestBook.library_id) !== Number(libraryId)) {
            return res.status(404).json({ ok: false, message: "Request not found in your library" });
        }
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
        const query = String(req.query.q || "").trim();
        const search = query || "library science";
        const failures = [];

        console.log("Searching books:", search);

        try {
            const books = await searchGoogleBooksApi(search);
            if (books.length) {
                return res.json({ ok: true, source: "google", books });
            }
            failures.push("Google Books returned no matches");
        } catch (error) {
            failures.push(error.message);
            console.log("Google Books Error:", error.message);
        }

        try {
            const books = await searchOpenLibraryApi(search);
            if (books.length) {
                return res.json({ ok: true, source: "open-library", books });
            }
            failures.push("Open Library returned no matches");
        } catch (error) {
            failures.push(error.message);
            console.log("Open Library Error:", error.message);
        }

        const books = sampleGoogleBooks(search);
        res.json({
            ok: true,
            source: "sample",
            warning: failures.join(" | "),
            books
        });

    } catch (error) {
        console.log("Book Search Error:", error);

        res.status(500).json({
            ok: false,
            message: "Could not search books right now"
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
