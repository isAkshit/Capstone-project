document.addEventListener("DOMContentLoaded", () => {
    const booksContainer = document.getElementById("books-container");
    const searchBox = document.querySelector(".search-box");
    const totalFine = document.getElementById("total-fine");
    const userName = document.querySelector(".user-info b");
    const avatar = document.querySelector(".avatar");

    let allBooks = [];
    let myRequests = [];

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            },
            ...options
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
            throw new Error(data.message || "Request failed");
        }
        return data;
    }

    function initials(name) {
        return name
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();
    }

    function requestForBook(bookId) {
        return myRequests.find((request) => {
            return Number(request.book_id) === Number(bookId) && request.status !== "Rejected";
        });
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderBooks() {
        const search = searchBox.value.trim().toLowerCase();
        const books = search
            ? allBooks.filter((book) => {
                return [book.title, book.author, book.category].some((value) =>
                    String(value || "").toLowerCase().includes(search)
                );
            })
            : allBooks;

        booksContainer.innerHTML = "";

        if (!books.length) {
            booksContainer.innerHTML = `
                <div class="empty-library-search">
                    No saved library books found.
                </div>
            `;
            return;
        }

        books.forEach((book) => {
            const request = requestForBook(book.id);
            const rejectedRequest = myRequests.find((item) => {
                return Number(item.book_id) === Number(book.id) && item.status === "Rejected";
            });
            const unavailable = Number(book.available_copies) <= 0;
            let statusMessage = "";
            let buttonText = "Borrow";
            let disabled = unavailable;

            if (request && request.status === "Pending") {
                statusMessage = "Request sent. Waiting for admin approval.";
                buttonText = "Pending";
                disabled = true;
            } else if (request && request.status === "Granted") {
                statusMessage = "Request granted. You can collect this book.";
                buttonText = "Granted";
                disabled = true;
            } else if (rejectedRequest) {
                statusMessage = "Request rejected. Try again?";
                buttonText = "Try Again";
                disabled = unavailable;
            } else if (unavailable) {
                statusMessage = "Currently unavailable.";
                buttonText = "Unavailable";
            }

            const card = document.createElement("div");
            card.className = "book";
            card.innerHTML = `
                <img src="${escapeHtml(book.cover_url || "https://via.placeholder.com/90x130?text=Book")}" alt="${escapeHtml(book.title)}">
                <div class="details">
                    <b class="book-title">${escapeHtml(book.title)}</b>
                    <p>${escapeHtml(book.author || "Unknown author")}</p>
                    <p class="${Number(book.available_copies) > 0 ? "green-text" : "red-text"}">
                        Available: ${book.available_copies}
                    </p>
                    ${statusMessage ? `<p class="request-status ${escapeHtml((request && request.status) || (rejectedRequest && rejectedRequest.status) || "Unavailable")}">${escapeHtml(statusMessage)}</p>` : ""}
                    <button data-book-id="${book.id}" ${disabled ? "disabled" : ""}>${escapeHtml(buttonText)}</button>
                </div>
            `;
            booksContainer.appendChild(card);
        });
    }

    async function loadDashboard() {
        try {
            const data = await fetchJson("/api/student/dashboard");
            allBooks = data.books;
            myRequests = data.requests;

            if (userName) userName.textContent = data.user.name;
            if (avatar) avatar.textContent = initials(data.user.name);
            totalFine.textContent = `Rs. ${Number(data.totalFine).toFixed(2)}`;
            renderBooks();
        } catch (error) {
            alert(error.message);
            window.location.href = "/login/login.html";
        }
    }

    booksContainer.addEventListener("click", async (event) => {
        const bookId = event.target.dataset.bookId;
        if (!bookId) return;

        try {
            await fetchJson("/api/borrow-requests", {
                method: "POST",
                body: JSON.stringify({
                    book_id: Number(bookId),
                    days_requested: 7
                })
            });
            await loadDashboard();
        } catch (error) {
            alert(error.message);
        }
    });

    searchBox.addEventListener("input", renderBooks);
    loadDashboard();
});

