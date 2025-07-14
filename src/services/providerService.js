// src/services/providerService.js
import Provider from '../models/Provider.js';
import Package from '../models/Package.js';
import logger from '../utils/logger.js';

class ProviderService {
  // Create provider (Admin/Super Admin only)
  async createProvider(providerData) {
    try {
      // Check if provider already exists (global check)
      const existingProvider = await Provider.findOne({
        code: providerData.code
      });
      
      if (existingProvider) {
        throw new Error(`Provider with code ${providerData.code} already exists`);
      }
      
      const provider = new Provider(providerData);
      await provider.save();
      
      logger.info(`Provider created: ${provider._id} by user ${providerData.createdBy}`);
      return provider;
    } catch (error) {
      logger.error(`Provider creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get providers with filtering (accessible to all users)
  async getProviders(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 20, sortBy = 'name', sortOrder = 1 } = pagination;
      const { search, isActive = true, includeDeleted = false } = filters;
      
      const query = {};
      
      if (!includeDeleted) {
        query.isDeleted = false;
      }
      
      if (isActive !== undefined) {
        query.isActive = isActive;
      }
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { code: { $regex: search, $options: 'i' } }
        ];
      }
      
      const [providers, total] = await Promise.all([
        Provider.find(query)
          .populate('createdBy', 'fullName email')
          .populate('updatedBy', 'fullName email')
          .skip((page - 1) * limit)
          .limit(Number(limit))
          .sort({ [sortBy]: sortOrder }),
        Provider.countDocuments(query)
      ]);
      
      return {
        providers,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / limit),
          limit: Number(limit)
        }
      };
    } catch (error) {
      logger.error(`Get providers failed: ${error.message}`);
      throw error;
    }
  }

  // Get provider by ID (accessible to all users)
  async getProviderById(id) {
    try {
      const provider = await Provider.findOne({ 
        _id: id, 
        isDeleted: false
      });
      
      if (!provider) {
        throw new Error('Provider not found');
      }
      
      return provider;
    } catch (error) {
      logger.error(`Get provider by ID failed: ${error.message}`);
      throw error;
    }
  }

  // Update provider (Admin/Super Admin only)
  async updateProvider(id, updateData, userId) {
    try {
      // Don't allow changing the provider code
      if (updateData.code) {
        delete updateData.code;
      }
      
      const provider = await Provider.findOneAndUpdate(
        { 
          _id: id, 
          isDeleted: false 
        },
        {
          ...updateData,
          updatedBy: userId
        },
        { new: true }
      );
      
      if (!provider) {
        throw new Error('Provider not found');
      }
      
      logger.info(`Provider updated: ${id} by user ${userId}`);
      return provider;
    } catch (error) {
      logger.error(`Provider update failed: ${error.message}`);
      throw error;
    }
  }

  // Soft delete provider (Admin/Super Admin only)
  async softDeleteProvider(id, userId) {
    try {
      const provider = await Provider.findOne({ 
        _id: id, 
        isDeleted: false 
      });
      
      if (!provider) {
        throw new Error('Provider not found or already deleted');
      }
      
      await provider.softDelete(userId);
      
      logger.info(`Provider deleted: ${id} by user ${userId}`);
      return provider;
    } catch (error) {
      logger.error(`Provider deletion failed: ${error.message}`);
      throw error;
    }
  }

  // Restore provider (Admin/Super Admin only)
  async restoreProvider(id, userId) {
    try {
      const provider = await Provider.findOne({ 
        _id: id, 
        isDeleted: true 
      });
      
      if (!provider) {
        throw new Error('Provider not found or not deleted');
      }
      
      await provider.restore();
      provider.updatedBy = userId;
      await provider.save();
      
      logger.info(`Provider restored: ${id} by user ${userId}`);
      return provider;
    } catch (error) {
      logger.error(`Provider restoration failed: ${error.message}`);
      throw error;
    }
  }

  // Get provider analytics (accessible to all users)
  async getProviderAnalytics() {
    try {
      const providers = await Provider.find({
        isDeleted: false,
        isActive: true
      });
      
      const analytics = await Promise.all(providers.map(async (provider) => {
        // Get packages for this provider (across all tenants)
        const packageCounts = await Package.aggregate([
          { 
            $match: { 
              provider: provider.code,
              isDeleted: false
            } 
          },
          { 
            $group: { 
              _id: null, 
              count: { $sum: 1 },
              sales: { $sum: "$salesCount" },
              views: { $sum: "$viewCount" }
            } 
          }
        ]);
        
        return {
          _id: provider._id,
          name: provider.name,
          code: provider.code,
          logo: provider.logo,
          packageCount: packageCounts[0]?.count || 0,
          sales: packageCounts[0]?.sales || 0,
          views: packageCounts[0]?.views || 0
        };
      }));
      
      return analytics;
    } catch (error) {
      logger.error(`Get provider analytics failed: ${error.message}`);
      throw error;
    }
  }
}

export default new ProviderService();
