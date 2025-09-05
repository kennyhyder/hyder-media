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
