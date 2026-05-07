CREATE DATABASE Library_db;
USE LIBRARY_DB;

CREATE TABLE books (
book_id INT AUTO_INCREMENT PRIMARY KEY,
title VARCHAR(100) NOT NULL,
author VARCHAR(100),
available_copies INT DEFAULT 1
);

CREATE TABLE members (
member_id INT AUTO_INCREMENT PRIMARY KEY,
name VARCHAR(100) NOT NULL,
phone VARCHAR(15)
);

CREATE TABLE issued_books (
issue_id INT AUTO_INCREMENT PRIMARY KEY,
book_id INT,
member_id INT,
issue_date DATE,
return_date DATE,
FOREIGN KEY (book_id) REFERENCES books(book_id),
FOREIGN KEY (member_id) REFERENCES members(member_id)
);

ALTER TABLE members
ADD COLUMN email VARCHAR(100) UNIQUE,
ADD COLUMN password VARCHAR(100),
ADD COLUMN role ENUM('student','admin')
DEFAULT 'student',
ADD COLUMN joined_at DATE;

CREATE TABLE libraries ( library_id INT AUTO_INCREMENT PRIMARY KEY,
library_name VARCHAR(100) NOT NULL,
admin_id INT,
FOREIGN KEY (admin_id) REFERENCES members(member_id)
);

CREATE TABLE library_members( membership_id INT AUTO_INCREMENT PRIMARY KEY,
member_id INT,
library_id INT,
joined_date DATE,
FOREIGN KEY (member_id) REFERENCES members(member_id),
FOREIGN KEY (library_id)
REFERENCES libraries(library_id)
);

ALTER TABLE books
ADD COLUMN category VARCHAR(50),
ADD COLUMN total_stock INT DEFAULT 0,
ADD COLUMN mode
ENUM('online','offline'),
ADD COLUMN library_id INT,
ADD FOREIGN KEY (library_id)
REFERENCES libraries(library_id);

ALTER TABLE issued_books
ADD COLUMN days_requested INT,
ADD COLUMN status
ENUM('Pending','Granted','returned')
DEFAULT 'Pending',
ADD COLUMN due_date DATE;

CREATE TABLE fines(
fine_id INT AUTO_INCREMENT PRIMARY KEY,
member_id INT,
amount DECIMAL(10,2),
reason VARCHAR(255),
status ENUM('paid','unpaid')
DEFAULT 'unpaid',
FOREIGN KEY (member_id) REFERENCES members(member_id)
);

