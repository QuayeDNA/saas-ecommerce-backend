# SAAS E-Commerce Backend API

A comprehensive multi-vendor e-commerce platform backend built with Node.js, Express.js, and MongoDB.

## 🚀 Features

- **Multi-vendor E-commerce** - Support for multiple vendors and agents
- **Real-time Communication** - WebSocket integration for live updates
- **Commission Management** - Automated commission calculation and tracking
- **JWT Authentication** - Secure authentication and authorization
- **Push Notifications** - VAPID-based push notifications
- **Analytics** - Real-time analytics and reporting

## 🛠️ Technology Stack

- **Runtime**: Node.js with ES Modules
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with bcrypt
- **Real-time**: WebSocket (ws library)
- **Validation**: Joi schema validation
- **Logging**: Winston logger
- **Email**: Nodemailer with Gmail
- **Push Notifications**: Web Push API with VAPID

## 📋 Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or cloud instance)
- Git

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd saas-ecommerce-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your actual values
# Required: MongoDB URI, JWT secrets, email settings
```

### 4. Start the Server

```bash
# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:5050`

## 🔧 Environment Variables

### Required

- `DBURI` - MongoDB connection string
- `JWTSECRET` - JWT signing secret (generate a strong random string)
- `REFRESH_TOKEN_SECRET` - Refresh token secret
- `EMAIL_USER` - Gmail address for notifications
- `EMAIL_PASSWORD` - Gmail app password

### Optional

- `PORT` - Server port (default: 5050)
- `NODE_ENV` - Environment mode (development/production)
- `FRONTEND_URL` - Frontend application URL

## 📊 API Endpoints

The API provides comprehensive endpoints for:

- User authentication and management
- Product and order management
- Commission tracking and analytics
- Notification management
- Settings and configuration

### Health Checks

- `GET /` - Welcome page with system status
- `GET /health` - General health check

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt
- CORS protection
- Helmet security headers
- Input validation with Joi

## 📈 Performance

- Connection pooling for database efficiency
- Optimized queries and indexing
- Background job processing

## 🧪 Development

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Check code quality
npm run build
```

## 📚 Documentation

API documentation is available in the `/docs/` folder.

## 🚀 Deployment

### Render (Recommended for Free Tier)

1. Connect your GitHub repository
2. Set environment variables in Render dashboard
3. Deploy automatically on git push

### Other Platforms

- Vercel
- Railway
- Heroku
- DigitalOcean App Platform

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions, please check the documentation or create an issue in the repository.
