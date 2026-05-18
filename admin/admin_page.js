document.addEventListener("DOMContentLoaded", () => {
    const bookTable = document.getElementById("bookTable");
    const requestTable = document.getElementById("requestTable");
    const memberTable = document.getElementById("memberTable");
    const fineTable = document.getElementById("fineTable");
    const searchBar = document.getElementById("search_bar");
    const bookHeader = document.getElementById("head_box5");
    const bookBox = document.getElementById("box5");

    let dashboardData = null;
    let searchTimer = null;

    const addBookButton = document.createElement("button");
    addBookButton.id = "addGoogleBookBtn";
    addBookButton.textContent = "Add Book";
    bookHeader.appendChild(addBookButton);

    const googlePanel = document.createElement("div");
    googlePanel.id = "googleBookPanel";
    googlePanel.classList.add("hidden");
    googlePanel.innerHTML = `
        <div class="google-panel-top">
            <div>
                <h4>Book Search</h4>
                <p>Search by title, author, or topic and add the best match to your library.</p>
            </div>
            <button type="button" id="closeGooglePanel">Close</button>
        </div>
        <div id="googleBookResults" class="google-book-results">
            <p class="empty-search-text">Type a book name in the search box above.</p>
        </div>
    `;
    bookBox.insertBefore(googlePanel, document.getElementById("table1"));

    const googleResults = document.getElementById("googleBookResults");
    const closeGooglePanel = document.getElementById("closeGooglePanel");

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

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function activateGoogleSearch() {
        googlePanel.classList.remove("hidden");
        searchBar.placeholder = "Search books to add...";
        searchBar.focus();
        searchGoogleBooks(searchBar.value.trim());
    }

    function closeGoogleSearch() {
        googlePanel.classList.add("hidden");
        searchBar.placeholder = "Search books...";
        googleResults.innerHTML = `<p class="empty-search-text">Type a book name in the search box above.</p>`;
    }

    function renderBooks(books) {
        bookTable.innerHTML = "";

        if (!books.length) {
            bookTable.innerHTML = `
                <tr>
                    <td colspan="3">No books added yet.</td>
                </tr>
            `;
            return;
        }

        books.forEach((book) => {
            const row = document.createElement("tr");
            const status = Number(book.available_copies) > 0 ? "Available" : "Unavailable";

            row.innerHTML = `
                <td>${escapeHtml(book.title)}</td>
                <td>${status}</td>
                <td>
                    <button data-delete-book="${book.id}">Delete</button>
                </td>
            `;
            bookTable.appendChild(row);
        });
    }

    function renderRequests(requests) {
        requestTable.innerHTML = "";

        if (!requests.length) {
            requestTable.innerHTML = `
                <tr>
                    <td colspan="3">No borrow requests.</td>
                </tr>
            `;
            return;
        }

        requests.forEach((request) => {
            const row = document.createElement("tr");
            const actionHtml = request.status === "Pending"
                ? `
                    <button data-request-id="${request.id}" data-status="Granted">Grant</button>
                    <button data-request-id="${request.id}" data-status="Rejected">Reject</button>
                `
                : escapeHtml(request.status);

            row.innerHTML = `
                <td>${escapeHtml(request.member_name)}</td>
                <td>${escapeHtml(request.title)}</td>
                <td>${actionHtml}</td>
            `;
            requestTable.appendChild(row);
        });
    }

    function renderMembers(members) {
        memberTable.innerHTML = "";

        members.forEach((member) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${escapeHtml(member.name)}</td>
                <td>${escapeHtml(member.role)}</td>
                <td>${escapeHtml(member.email)}</td>
            `;
            memberTable.appendChild(row);
        });
    }

    function renderFines(fines) {
        fineTable.innerHTML = "";

        if (!fines.length) {
            fineTable.innerHTML = `
                <tr>
                    <td colspan="3">No fines.</td>
                </tr>
            `;
            return;
        }

        fines.forEach((fine) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${escapeHtml(fine.member_name)}</td>
                <td>Rs. ${Number(fine.amount).toFixed(2)}</td>
                <td>${escapeHtml(fine.status)}</td>
            `;
            fineTable.appendChild(row);
        });
    }

    function renderGoogleBooks(books) {
        if (!books.length) {
            googleResults.innerHTML = `<p class="empty-search-text">No book results found.</p>`;
            return;
        }

        googleResults.innerHTML = "";

        books.forEach((book) => {
            const item = document.createElement("div");
            item.className = "google-book-card";
            item.innerHTML = `
                <img src="${escapeHtml(book.cover_url || "")}" alt="${escapeHtml(book.title)}">
                <div class="google-book-info">
                    <b>${escapeHtml(book.title)}</b>
                    <span>${escapeHtml(book.author || "Unknown author")}</span>
                    <small>${escapeHtml(book.category || "General")}</small>
                </div>
                <div class="google-book-actions">
                    <input
                        type="number"
                        class="book-copy-input"
                        min="1"
                        max="999"
                        value="1"
                        aria-label="Copies to add"
                    >
                    <button
                        type="button"
                        class="add-result-btn"
                        data-title="${escapeHtml(book.title)}"
                        data-author="${escapeHtml(book.author || "")}"
                        data-category="${escapeHtml(book.category || "General")}"
                        data-cover="${escapeHtml(book.cover_url || "")}"
                    >
                        + Add
                    </button>
                </div>
            `;
            googleResults.appendChild(item);
        });

        googleResults.querySelectorAll("img").forEach((image) => {
            image.addEventListener("error", () => {
                image.removeAttribute("src");
                image.classList.add("book-cover-fallback");
                image.alt = "Book cover unavailable";
            });

            if (!image.getAttribute("src")) {
                image.classList.add("book-cover-fallback");
            }
        });
    }

    async function searchGoogleBooks(query) {
        if (!query) {
            googleResults.innerHTML = `<p class="empty-search-text">Type a book name in the search box above.</p>`;
            return;
        }

        googleResults.innerHTML = `<p class="empty-search-text">Searching books...</p>`;

        try {
            const data = await fetchJson(`/api/google-books?q=${encodeURIComponent(query)}`);
            renderGoogleBooks(data.books);
        } catch (error) {
            googleResults.innerHTML = `<p class="empty-search-text">${escapeHtml(error.message)}</p>`;
        }
    }

    async function loadDashboard() {
        try {
            dashboardData = await fetchJson("/api/admin/dashboard");

            setText("h_kpi1", dashboardData.stats.totalBooks);
            setText("h_kpi2", dashboardData.stats.totalMembers);
            setText("h_kpi3", dashboardData.stats.pendingRequests);
            setText("h_kpi4", dashboardData.stats.overdueCount);
            renderBooks(dashboardData.books);
            renderRequests(dashboardData.requests);
            renderMembers(dashboardData.members);
            renderFines(dashboardData.fines);
        } catch (error) {
            alert(error.message);
            window.location.href = "/login/login.html";
        }
    }

    addBookButton.addEventListener("click", activateGoogleSearch);
    searchBar.addEventListener("focus", activateGoogleSearch);
    closeGooglePanel.addEventListener("click", closeGoogleSearch);

    searchBar.addEventListener("input", () => {
        if (googlePanel.classList.contains("hidden")) {
            return;
        }

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchGoogleBooks(searchBar.value.trim());
        }, 350);
    });

    googleResults.addEventListener("click", async (event) => {
        const button = event.target.closest(".add-result-btn");
        if (!button) return;

        const card = button.closest(".google-book-card");
        const copyInput = card.querySelector(".book-copy-input");
        const copies = Math.max(1, Math.min(Number.parseInt(copyInput.value, 10) || 1, 999));

        copyInput.value = copies;
        copyInput.disabled = true;
        button.disabled = true;
        button.textContent = "Adding...";

        try {
            await fetchJson("/api/books", {
                method: "POST",
                body: JSON.stringify({
                    title: button.dataset.title,
                    author: button.dataset.author,
                    category: button.dataset.category,
                    cover_url: button.dataset.cover,
                    available_copies: copies,
                    total_stock: copies,
                    mode: "offline"
                })
            });

            button.textContent = "Added";
            await loadDashboard();
        } catch (error) {
            copyInput.disabled = false;
            button.disabled = false;
            button.textContent = "+ Add";
            alert(error.message);
        }
    });

    bookTable.addEventListener("click", async (event) => {
        const bookId = event.target.dataset.deleteBook;
        if (!bookId || !confirm("Delete this book?")) return;

        try {
            await fetchJson(`/api/books/${bookId}`, { method: "DELETE" });
            await loadDashboard();
        } catch (error) {
            alert(error.message);
        }
    });

    requestTable.addEventListener("click", async (event) => {
        const requestId = event.target.dataset.requestId;
        const status = event.target.dataset.status;
        if (!requestId || !status) return;

        try {
            await fetchJson(`/api/borrow-requests/${requestId}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status })
            });
            await loadDashboard();
        } catch (error) {
            alert(error.message);
        }
    });

    loadDashboard();
});
