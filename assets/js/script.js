const toggleSwitch = document.getElementById('toggleSwitch');
const root = document.documentElement;

toggleSwitch.checked = root.classList.contains('dark-mode');

toggleSwitch.addEventListener('change', function () {
    if (this.checked) {
        root.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
    } else {
        root.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
    }
});

// Contact Form Handler
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    const submitBtn = document.getElementById('submitBtn');
    const formMessage = document.getElementById('formMessage');
    const charCount = document.getElementById('charCount');
    const messageField = document.getElementById('message');

    // Character counter
    if (messageField && charCount) {
        messageField.addEventListener('input', function() {
            const length = this.value.length;
            charCount.textContent = length;
            if (length > 1000) {
                this.value = this.value.substring(0, 1000);
                charCount.textContent = 1000;
            }
        });
    }

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Disable submit button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        // Get form data
        const formData = {
            name: document.getElementById('name').value.trim(),
            email: document.getElementById('email').value.trim(),
            message: document.getElementById('message').value.trim(),
            website: document.getElementById('website').value // Honeypot
        };

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (result.success) {
                showMessage('success', result.message);
                form.reset();
                if (charCount) charCount.textContent = '0';
            } else {
                showMessage('error', result.message);
            }
        } catch (error) {
            console.error('Error:', error);
            showMessage('error', 'Network error. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'SEND MESSAGE';
        }
    });

    function showMessage(type, message) {
        formMessage.style.display = 'block';
        formMessage.textContent = message;
        formMessage.style.backgroundColor = type === 'success' ? '#d4edda' : '#f8d7da';
        formMessage.style.color = type === 'success' ? '#155724' : '#721c24';
        formMessage.style.border = type === 'success' ? '1px solid #c3e6cb' : '1px solid #f5c6cb';

        if (type === 'success') {
            setTimeout(() => {
                formMessage.style.display = 'none';
            }, 5000);
        }
    }
});
// assets/js/script.js

// Dark Mode Toggle (your existing code)
document.addEventListener('DOMContentLoaded', function() {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const body = document.body;
    const html = document.documentElement;

    // Check saved theme or system preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        html.classList.add('dark-mode');
        if (toggleSwitch) toggleSwitch.checked = true;
    }

    // Handle theme toggle
    if (toggleSwitch) {
        toggleSwitch.addEventListener('change', function() {
            if (this.checked) {
                html.classList.add('dark-mode');
                localStorage.setItem('theme', 'dark');
            } else {
                html.classList.remove('dark-mode');
                localStorage.setItem('theme', 'light');
            }
        });
    }

    // Contact Form Handler
    const contactForm = document.getElementById('contactForm');
    const submitBtn = document.getElementById('submitBtn');
    const formMessage = document.getElementById('formMessage');
    const charCount = document.getElementById('charCount');
    const messageTextarea = document.getElementById('message');
    
    // Character counter
    if (messageTextarea && charCount) {
        messageTextarea.addEventListener('input', function() {
            charCount.textContent = this.value.length;
            if (this.value.length > 1000) {
                this.value = this.value.substring(0, 1000);
                charCount.textContent = 1000;
            }
        });
    }
    
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Clear previous errors
            document.querySelectorAll('.form__error').forEach(error => {
                error.style.display = 'none';
                error.textContent = '';
            });
            
            // Get form data
            const formData = {
                name: document.getElementById('name').value.trim(),
                email: document.getElementById('email').value.trim(),
                message: document.getElementById('message').value.trim(),
                website: document.getElementById('website').value // honeypot
            };
            
            // Client-side validation
            let hasError = false;
            
            // Name validation
            if (!formData.name || formData.name.length < 2 || formData.name.length > 50) {
                showError('name', 'Please enter a valid name (2-50 characters)');
                hasError = true;
            }
            
            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!formData.email || !emailRegex.test(formData.email)) {
                showError('email', 'Please enter a valid email address');
                hasError = true;
            }
            
            // Message validation
            if (!formData.message || formData.message.length < 10 || formData.message.length > 1000) {
                showError('message', 'Message must be between 10 and 1000 characters');
                hasError = true;
            }
            
            if (hasError) {
                return;
            }
            
            // Disable submit button and show loading state
            submitBtn.disabled = true;
            submitBtn.textContent = 'SENDING...';
            
            try {
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(formData)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Show success message
                    showMessage('success', result.message || 'Thank you for your message! I\'ll get back to you soon.');
                    // Reset form
                    contactForm.reset();
                    if (charCount) charCount.textContent = '0';
                } else {
                    // Show error message
                    showMessage('error', result.message || 'An error occurred. Please try again later.');
                }
            } catch (error) {
                console.error('Error:', error);
                showMessage('error', 'An error occurred. Please check your connection and try again.');
            } finally {
                // Re-enable submit button
                submitBtn.disabled = false;
                submitBtn.textContent = 'SEND MESSAGE';
            }
        });
    }
    
    function showError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const errorElement = field.parentElement.querySelector('.form__error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }
    
    function showMessage(type, message) {
        if (formMessage) {
            formMessage.textContent = message;
            formMessage.style.display = 'block';
            
            if (type === 'success') {
                formMessage.style.backgroundColor = '#d4edda';
                formMessage.style.color = '#155724';
                formMessage.style.border = '1px solid #c3e6cb';
            } else {
                formMessage.style.backgroundColor = '#f8d7da';
                formMessage.style.color = '#721c24';
                formMessage.style.border = '1px solid #f5c6cb';
            }
            
            // Hide message after 5 seconds
            setTimeout(() => {
                formMessage.style.display = 'none';
            }, 5000);
        }
    }
});
