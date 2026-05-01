document.addEventListener("DOMContentLoaded", () => {
    // DOM Elements
    const signInSection = document.getElementById('sign-in-section');
    const signUpSection = document.getElementById('sign-up-section');
    const goToSignUpBtn = document.getElementById('go-to-signup');
    const goToSignInBtn = document.getElementById('go-to-signin');
    
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    
    const roleCards = document.querySelectorAll('.role-card');

    // Toggle to Sign Up form
    goToSignUpBtn.addEventListener('click', () => {
        signInSection.classList.add('hidden');
        signUpSection.classList.remove('hidden');
        
        // Update Headers
        pageTitle.textContent = "Create an Account";
        pageSubtitle.textContent = "Join CircuLib to start borrowing";
    });

    // Toggle back to Sign In form
    goToSignInBtn.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default link behavior
        signUpSection.classList.add('hidden');
        signInSection.classList.remove('hidden');
        
        // Update Headers
        pageTitle.textContent = "Welcome Back";
        pageSubtitle.textContent = "Sign in to your CircuLib account";
    });

    // Handle Role Card Selection
    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            // Remove active class from all
            roleCards.forEach(c => c.classList.remove('active'));
            // Add to clicked
            card.classList.add('active');
        });
    });
});