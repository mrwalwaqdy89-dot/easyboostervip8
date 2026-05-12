// Email Configuration
// This file contains email-related settings for the ANDY RCH application
// Update these values directly instead of using .env file

module.exports = {
    // Email Settings (Nodemailer SMTP)
    // Supports Gmail, Hostinger, and other SMTP providers
    enabled: true, // Set to false to disable email functionality
    
    from: {
        name: 'ANDY RCH - Easy Booster',
        email: 'usaa6916@gmail.com'
    },
    
    // SMTP Configuration - Using Gmail
    // For Gmail: Use smtp.gmail.com, port 587, and an App Password
    // For Hostinger: Use smtp.hostinger.com, port 587
    // For other providers: Update host, port, and credentials accordingly
    smtp: {
        host: 'smtp.gmail.com', // Gmail SMTP host
        port: 587, // TLS port (use 465 for SSL)
        secure: false, // true for 465, false for other ports
        auth: {
            user: 'usaa6916@gmail.com', // Gmail address
            pass: 'hpfh ygdm zkmw pmbw' // Gmail App Password
        }
    }
    
    // Alternative SMTP configurations (examples):
    // Hostinger:
    // smtp: {
    //     host: 'smtp.hostinger.com',
    //     port: 587,
    //     secure: false,
    //     auth: { user: 'your-email@yourdomain.com', pass: 'your-password' }
    // }
    // 
    // Custom SMTP:
    // smtp: {
    //     host: 'mail.yourdomain.com',
    //     port: 587,
    //     secure: false,
    //     auth: { user: 'email@yourdomain.com', pass: 'password' }
    // }
};
