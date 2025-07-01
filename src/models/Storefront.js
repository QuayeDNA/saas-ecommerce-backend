// src/models/Storefront.js
import mongoose from 'mongoose';

const socialLinksSchema = new mongoose.Schema({
  facebook: String,
  twitter: String,
  instagram: String,
  whatsapp: String,
  telegram: String,
  website: String
}, { _id: false });

const contactInfoSchema = new mongoose.Schema({
  email: String,
  phone: String,
  address: String,
  workingHours: String,
  socialLinks: socialLinksSchema
}, { _id: false });

const seoSchema = new mongoose.Schema({
  title: String,
  description: String,
  keywords: [String],
  ogImage: String
}, { _id: false });

const themeSchema = new mongoose.Schema({
  primaryColor: { type: String, default: '#3B82F6' },
  secondaryColor: { type: String, default: '#1F2937' },
  accentColor: { type: String, default: '#10B981' },
  backgroundColor: { type: String, default: '#FFFFFF' },
  textColor: { type: String, default: '#1F2937' },
  fontFamily: { type: String, default: 'Inter' },
  layout: { 
    type: String, 
    enum: ['grid', 'list', 'card'], 
    default: 'grid' 
  },
  headerStyle: {
    type: String,
    enum: ['minimal', 'classic', 'modern'],
    default: 'modern'
  }
}, { _id: false });

const storefrontSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true, // This already creates an index
    lowercase: true,
    match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens']
  },
  
  // Owner Information
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // This already creates an index
  },
  
  // Storefront Configuration
  isActive: {
    type: Boolean,
    default: true
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  
  // Branding
  logo: String,
  banner: String,
  favicon: String,
  
  // Theme and Styling
  theme: themeSchema,
  
  // Contact Information
  contactInfo: contactInfoSchema,
  
  // SEO Configuration
  seo: seoSchema,
  
  // Business Settings
  currency: {
    type: String,
    default: 'USD'
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  language: {
    type: String,
    default: 'en'
  },
  
  // Features
  features: {
    showPrices: { type: Boolean, default: true },
    allowOrders: { type: Boolean, default: true },
    showInventory: { type: Boolean, default: false },
    requireCustomerInfo: { type: Boolean, default: true },
    enableWhatsAppOrders: { type: Boolean, default: false },
    enableSearch: { type: Boolean, default: true },
    enableCategories: { type: Boolean, default: true }
  },
  
  // Analytics
  analytics: {
    totalViews: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    lastVisit: Date
  },
  
  // Custom Pages
  customPages: [{
    title: String,
    slug: String,
    content: String,
    isActive: { type: Boolean, default: true }
  }],
  
  // Announcement/Banner
  announcement: {
    text: String,
    isActive: { type: Boolean, default: false },
    type: {
      type: String,
      enum: ['info', 'warning', 'success', 'error'],
      default: 'info'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Only add compound indexes that aren't duplicated
storefrontSchema.index({ isActive: 1, isPublic: 1 });
storefrontSchema.index({ isActive: 1, createdAt: -1 });
storefrontSchema.index({ isPublic: 1, createdAt: -1 });

// Virtual for storefront URL
storefrontSchema.virtual('url').get(function() {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${baseUrl}/store/${this.slug}`;
});

// Pre-save middleware for slug generation
storefrontSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/(^-)|(-$)/g, '');
  }
  next();
});

// Instance methods
storefrontSchema.methods.incrementViews = function() {
  this.analytics.totalViews += 1;
  this.analytics.lastVisit = new Date();
  return this.save();
};

storefrontSchema.methods.incrementOrders = function() {
  this.analytics.totalOrders += 1;
  return this.save();
};

export default mongoose.model('Storefront', storefrontSchema);
