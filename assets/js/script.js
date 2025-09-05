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