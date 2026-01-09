const form = document.getElementById('reset-form') as HTMLFormElement;
const msg = document.getElementById('msg') as HTMLElement;
const submitBtn = form.querySelector('button');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    
    const passwordInput = document.getElementById('password') as HTMLInputElement;
    const confirmInput = document.getElementById('confirm-password') as HTMLInputElement;

    const p1 = passwordInput.value;
    const p2 = confirmInput.value;

    if (!token) {
        showMsg("Invalid reset link. Please request a new one.", "red");
        return;
    }

    if (p1 !== p2) {
        showMsg("Passwords do not match.", "red");
        return;
    }

    if (p1.length < 6) {
        showMsg("Password too short.", "red");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Resetting...";
    }

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, password: p1 })
        });
        const data = await res.json();

        if (res.ok) {
            showMsg("Password reset successfully! Redirecting...", "#44ff44");
            setTimeout(() => window.location.href = '/login', 2000);
        } else {
            showMsg(data.message || "Reset failed.", "red");
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = "Reset Password";
            }
        }
    } catch (err) {
        showMsg("Connection error.", "red");
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Reset Password";
        }
    }
});

function showMsg(text: string, color: string) {
    msg.textContent = text;
    msg.style.color = color;
    msg.style.display = 'block';
}