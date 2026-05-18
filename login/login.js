document.addEventListener("DOMContentLoaded", () => {
    const signInSection = document.getElementById("sign-in-section");
    const signUpSection = document.getElementById("sign-up-section");
    const goToSignUpBtn = document.getElementById("go-to-signup");
    const goToSignInBtn = document.getElementById("go-to-signin");
    const pageTitle = document.getElementById("page-title");
    const pageSubtitle = document.getElementById("page-subtitle");
    const roleCards = document.querySelectorAll(".role-card");
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const libraryCodeLabel = document.getElementById("library-code-label");
    const libraryCodeInput = document.getElementById("signup-library-code");

    function selectedRegisterRole() {
        const selectedRole = document.querySelector(".role-card.active");
        return selectedRole ? selectedRole.dataset.role : "member";
    }

    function updateLibraryCodeField() {
        const role = selectedRegisterRole();

        if (role === "admin") {
            libraryCodeLabel.textContent = "CREATE LIBRARY CODE";
            libraryCodeInput.placeholder = "Create a library code";
        } else {
            libraryCodeLabel.textContent = "ENTER LIBRARY CODE";
            libraryCodeInput.placeholder = "Enter your library code";
        }

        libraryCodeInput.value = libraryCodeInput.value.trim().toUpperCase();
    }

    goToSignUpBtn.addEventListener("click", () => {
        signInSection.classList.add("hidden");
        signUpSection.classList.remove("hidden");
        pageTitle.textContent = "Create an Account";
        pageSubtitle.textContent = "Join CircuLib to start borrowing";
        updateLibraryCodeField();
    });

    goToSignInBtn.addEventListener("click", (event) => {
        event.preventDefault();
        signUpSection.classList.add("hidden");
        signInSection.classList.remove("hidden");
        pageTitle.textContent = "Welcome Back";
        pageSubtitle.textContent = "Sign in to your CircuLib account";
    });

    roleCards.forEach((card) => {
        card.addEventListener("click", () => {
            roleCards.forEach((item) => item.classList.remove("active"));
            card.classList.add("active");
            updateLibraryCodeField();
        });
    });

    libraryCodeInput.addEventListener("input", () => {
        const cursorPosition = libraryCodeInput.selectionStart;
        libraryCodeInput.value = libraryCodeInput.value.toUpperCase().replace(/\s+/g, "-");
        libraryCodeInput.setSelectionRange(cursorPosition, cursorPosition);
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;

        try {
            const response = await fetch("/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.ok) {
                window.location.href = data.redirect;
            } else {
                alert(data.message);
            }
        } catch (error) {
            alert("Server error");
        }
    });

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = document.getElementById("signup-name").value.trim();
        const libraryCode = libraryCodeInput.value.trim();
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;
        const role = selectedRegisterRole();

        try {
            const response = await fetch("/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ name, libraryCode, email, password, role })
            });

            const data = await response.json();

            if (data.ok) {
                alert("Registration successful");
                window.location.href = data.redirect;
            } else {
                alert(data.message);
            }
        } catch (error) {
            alert("Server error");
        }
    });

    updateLibraryCodeField();
});
