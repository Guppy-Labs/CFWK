import nodemailer from 'nodemailer';

interface EmailOptions {
    email: string;
    subject: string;
    message: string; // Plain text fallback
    html?: string;   // Optional manual HTML override
    actionUrl?: string; // For button
    actionText?: string; // Button text
}

const getHtmlTemplate = (subject: string, message: string, actionUrl?: string, actionText?: string) => {
    const formattedMessage = message.replace(/\n/g, '<br>');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { margin: 0; padding: 0; background-color: #202028; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #e0e0e0; }
        .container { max-width: 600px; margin: 40px auto; background-color: #2d2d35; border: 1px solid #3a3a44; border-radius: 0; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        .header { background-color: #202028; padding: 20px; text-align: center; border-bottom: 2px solid #ff66aa; }
        .logo { color: #ff66aa; font-size: 24px; font-weight: bold; letter-spacing: 2px; text-decoration: none; }
        .content { padding: 40px 30px; text-align: center; }
        .title { color: #ffffff; font-size: 22px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
        .text { font-size: 16px; line-height: 1.6; color: #cccccc; margin-bottom: 30px; }
        .btn { display: inline-block; background-color: #ff66aa; color: #ffffff; text-decoration: none; padding: 14px 30px; font-size: 16px; font-weight: bold; border-radius: 0; transition: background 0.2s; }
        .btn:hover { background-color: #ff4499; }
        .footer { background-color: #1a1a20; padding: 20px; text-align: center; font-size: 12px; color: #666666; border-top: 1px solid #3a3a44; }
        .link-fallback { margin-top: 30px; font-size: 12px; color: #888; word-break: break-all; }
        .link-fallback a { color: #ff66aa; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">CFWK</div>
        </div>
        <div class="content">
            <h1 class="title">${subject.split(" - CFWK")[0]}</h1>
            <div class="text">
                ${formattedMessage.split('<br><br>http')[0]} <!-- Hacky split to remove raw link from text if present at end -->
            </div>
            
            ${actionUrl ? `
            <a href="${actionUrl}" class="btn">${actionText || 'Click Here'}</a>
            
            <div class="link-fallback">
                If the button doesn't work, copy this link:<br>
                <a href="${actionUrl}">${actionUrl}</a>
            </div>
            ` : ''}
        </div>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Gubby Labs. All rights reserved.
        </div>
    </div>
</body>
</html>
    `;
};

export const sendEmail = async (options: EmailOptions) => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log("---------------------------------------");
        console.log("Mock Email Send (Credentials not set):");
        console.log(`To: ${options.email}`);
        console.log(`Subject: ${options.subject}`);
        console.log(`Message: ${options.message}`);
        if(options.actionUrl) console.log(`Action: ${options.actionUrl}`);
        console.log("---------------------------------------");
        return;
    }

    const transporter = nodemailer.createTransport({
        service: 'Gmail', 
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/\s+/g, '') : ''
        }
    });

    const htmlContent = options.html || getHtmlTemplate(options.subject, options.message, options.actionUrl, options.actionText);

    const mailOptions = {
        from: process.env.EMAIL_FROM || 'CFWK <noreply@cfwk.com>',
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: htmlContent
    };

    try {
        await transporter.sendMail(mailOptions);
    } catch (error: any) {
        throw error; // may handle
    }
};
