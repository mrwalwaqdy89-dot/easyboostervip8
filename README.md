# ANDY RCH

Professional website for auto-reacting WhatsApp channel posts with emoji support. Features a modern GitHub-inspired dark theme and integrated 5SMM API for social media marketing services.

## Features

- 🎨 GitHub-inspired dark theme with modern, professional design
- 😊 Support for 80+ iOS-style emojis (select up to 16)
- 📊 Live statistics dashboard (request counter & system uptime)
- ⚡ Real-time validation and feedback
- 📱 Mobile-friendly responsive interface
- 🔄 Smooth animations and transitions
- ❓ FAQ section with accordion
- 💬 Customer testimonials
- 🚀 Ready for Heroku deployment
- 🔀 Dedicated `/reactch` page for form submission
- 🌟 **NEW: 5SMM API Integration** for social media marketing services

## Local Development

### Prerequisites

- Node.js 18.x or higher
- npm 9.x or higher

### Installation

1. Clone the repository:
```bash
git clone https://github.com/mr-Colab/Reactch.git
cd Reactch
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Deployment to Heroku

### Prerequisites

- Heroku account
- Heroku CLI installed

### Deployment Steps

1. Login to Heroku:
```bash
heroku login
```

2. Create a new Heroku app:
```bash
heroku create your-app-name
```

3. Deploy to Heroku:
```bash
git push heroku main
```

Or if you're on a different branch:
```bash
git push heroku your-branch-name:main
```

4. Open your deployed app:
```bash
heroku open
```

### Environment Variables (Optional)

If you need to set environment variables:
```bash
heroku config:set NODE_ENV=production
heroku config:set API_KEY=your_api_key
```

## API Endpoints

### POST /api/react
Submit a reaction request for a channel post.

**Request:**
```javascript
POST /api/react
Content-Type: application/json

{
  "channelLink": "https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXXXXX",
  "emojis": ["👍", "❤️", "🔥"]
}
```

**Response:**
```javascript
{
  "success": true,
  "message": "Reactions sent successfully!",
  "data": {
    "channelLink": "https://whatsapp.com/channel/0029VaXXXXXXXXXXXXXXXXX",
    "emojis": ["👍", "❤️", "🔥"],
    "reactionsCount": 3,
    "timestamp": "2025-11-23T16:00:00.000Z"
  }
}
```

### GET /api/stats
Get live statistics about the service.

**Response:**
```javascript
{
  "success": true,
  "data": {
    "requestCount": 42,
    "uptime": {
      "seconds": 3600,
      "formatted": "0d 1h 0m"
    },
    "startTime": "2025-11-23T15:00:00.000Z"
  }
}
```

### GET /health
Health check endpoint for monitoring.

**Response:**
```javascript
{
  "status": "ok",
  "timestamp": "2025-11-23T16:00:00.000Z",
  "uptime": 3600
}
```

## 5SMM API Integration

The platform now includes comprehensive integration with the 5SMM API for social media marketing services.

### Available SMM Services

- **4,474+ Services** across multiple platforms
- **Instagram** (808+ services): Followers, Likes, Views, Comments, Saves, etc.
- **TikTok** (328+ services): Followers, Likes, Views, Live Stream Views
- **Facebook, YouTube, Twitter, Telegram, Spotify** and more

### SMM API Endpoints

All SMM endpoints require authentication:

- `GET /api/smm/services` - Get all available services
- `GET /api/smm/services/instagram` - Get Instagram services
- `GET /api/smm/services/tiktok` - Get TikTok services
- `GET /api/smm/services/promo` - Get promotional/recommended services
- `POST /api/smm/order` - Create a new order
- `GET /api/smm/order/:orderId` - Get order status
- `GET /api/smm/balance` - Get account balance
- `POST /api/smm/refill` - Request order refill
- `POST /api/smm/cancel` - Cancel orders

### Documentation

See [SMM_API_DOCUMENTATION.md](./SMM_API_DOCUMENTATION.md) for complete API documentation and usage examples.

See [smm-examples.js](./smm-examples.js) for practical code examples.

### Configuration

Set these environment variables for 5SMM integration:

```bash
SMM_API_KEY=your_5smm_api_key
SMM_API_URL=https://5smm.com/api/v2
SMM_ENABLED=true
```

## Integration Notes

The website currently uses mock data for demonstration. To integrate with actual WhatsApp Bot API:

1. Update the `/api/react` endpoint in `server.js`
2. Add your WhatsApp Bot token to environment variables
3. Implement the WhatsApp Bot API calls
4. Update error handling and rate limiting

## Project Structure

```
.
├── index.html                  # Homepage with statistics dashboard
├── reactch.html               # React form page
├── server.js                  # Express server with API endpoints
├── smmService.js              # 5SMM API integration service
├── config.js                  # Configuration management
├── database.js                # Database operations
├── chatService.js             # AI chat functionality
├── emailService.js            # Email notifications
├── SMM_API_DOCUMENTATION.md   # 5SMM API documentation
├── smm-examples.js            # Usage examples for SMM API
├── package.json               # Node.js dependencies
├── Procfile                   # Heroku process file
├── .gitignore                 # Git ignore rules
└── README.md                  # This file
```

## Pages

- **Homepage (`/`)**: Landing page with hero section, live statistics, features, how it works, testimonials, and FAQ
- **React Channel (`/reactch`)**: Dedicated form page for submitting channel reactions

## Technology Stack

- **Frontend**: HTML5, Tailwind CSS (CDN), Vanilla JavaScript
- **Backend**: Node.js, Express
- **Deployment**: Heroku
- **API**: REST (ready for WhatsApp Bot API integration)
- **Design**: GitHub-inspired dark theme
- **Fonts**: Inter (system fonts fallback)
- **Icons**: Font Awesome 6.4.0

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please open an issue on GitHub.

## Design Features

### Theme Colors
- Background: `#0d1117` (GitHub dark)
- Card Background: `#161b22`
- Border: `#30363d`
- Accent Gradient: `#1f6feb` → `#0969da`
- Text Primary: `#c9d1d9`
- Text Secondary: `#8b949e`

### Animations
- Fade-in effects for sections
- Slide-in animations for statistics
- Hover scale transforms
- Smooth scroll navigation
- Loading spinners
- Counter animations
- Floating hero animation

### iOS-Style Emojis
All emojis are rendered using Apple Color Emoji font family for a consistent, professional appearance across all platforms.

## Author

ANDY RCH Team

---

Made with ❤️ for WhatsApp channel owners