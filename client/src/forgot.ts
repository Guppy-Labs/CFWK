const form = document.getElementById('forgot-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const messageDiv = document.getElementById('message') as HTMLDivElement;

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    messageDiv.style.display = 'none';
    messageDiv.className = 'msg';

    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await res.json();

        if (res.status === 429) {
             showMessage(data.message || 'Please wait before trying again.', 'error');
        } else if (res.ok) {
             showMessage(data.message || 'If an account exists, an email has been sent.', 'success');
             form.reset();
        } else {
             showMessage(data.message || 'Error occurred.', 'error');
        }
    } catch (err) {
        showMessage('Connection failed.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Reset Link';
    }
});

function showMessage(text: string, type: 'error' | 'success') {
    messageDiv.textContent = text;
    messageDiv.className = `msg ${type}`;
    messageDiv.style.display = 'block';
}