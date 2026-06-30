// src/services/providerService.js
import Provider from '../models/Provider.js';
import Package from '../models/Package.js';
import Bundle from '../models/Bundle.js';
import StorefrontPricing from '../models/StorefrontPricing.js';
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
      const { page = 1, limit = 20 } = pagination;
      const { search, isActive, includeDeleted = false } = filters;
      
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
      
      const [allProviders, total] = await Promise.all([
        Provider.find(query)
          .populate('createdBy', 'fullName email')
          .populate('updatedBy', 'fullName email')
          .lean(),
        Provider.countDocuments(query)
      ]);
      
      const providerPriority = { MTN: 1, TELECEL: 2, AT: 3, AFA: 4 };
      allProviders.sort((a, b) => {
        const priA = providerPriority[a.code] ?? 999;
        const priB = providerPriority[b.code] ?? 999;
        if (priA !== priB) return priA - priB;
        return (a.name || '').localeCompare(b.name || '');
      });
      
      const skip = (page - 1) * limit;
      const providers = allProviders.slice(skip, skip + Number(limit));
      
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
      
      const provider = await Provider.findOne({ 
        _id: id, 
        isDeleted: false 
      });
      
      if (!provider) {
        throw new Error('Provider not found');
      }
      
      // ── Cascade deactivation when provider is turned off ────────────────
      if (updateData.isActive === false && provider.isActive !== false) {
        await this._cascadeProviderDeactivation(provider, userId);
      }

      // ── Cascade reactivation when provider is turned on ─────────────────
      if (updateData.isActive === true && provider.isActive !== true) {
        await this._cascadeProviderReactivation(provider, userId);
      }

      Object.assign(provider, updateData, { updatedBy: userId });
      await provider.save();
      
      logger.info(`Provider updated: ${id} by user ${userId}`);
      return provider;
    } catch (error) {
      logger.error(`Provider update failed: ${error.message}`);
      throw error;
    }
  }

  // REFACTOR TODO: Remove cascade to bundles/storefront-pricing once bundle queries
  // check parent Package.isActive and Provider.isActive at query time (Path B).
  // When that's done, this method should only cascade to Package records.
  async _cascadeProviderDeactivation(provider, userId) {
    const providerCode = provider.code;
    const providerId = provider._id;

    // Deactivate all packages under this provider
    await Package.updateMany(
      { provider: providerCode, isDeleted: false },
      { isActive: false, updatedBy: userId },
    );

    // Deactivate all bundles linked to this provider
    const bundles = await Bundle.find({ providerId, isDeleted: false }).select('_id');
    const bundleIds = bundles.map((b) => b._id);

    if (bundleIds.length > 0) {
      await Bundle.updateMany(
        { _id: { $in: bundleIds } },
        { isActive: false },
      );

      // Deactivate storefront pricing for these bundles
      await StorefrontPricing.updateMany(
        { bundleId: { $in: bundleIds } },
        { isActive: false },
      );
    }

    logger.info(
      `[ProviderService] Deactivated ${bundleIds.length} bundle(s) and their storefront pricing for provider ${providerCode}`,
    );
  }

  async _cascadeProviderReactivation(provider, userId) {
    const providerCode = provider.code;
    const providerId = provider._id;

    // Reactivate all packages under this provider
    await Package.updateMany(
      { provider: providerCode, isDeleted: false },
      { isActive: true, updatedBy: userId },
    );

    // Reactivate all bundles linked to this provider
    const bundles = await Bundle.find({ providerId, isDeleted: false }).select('_id');
    const bundleIds = bundles.map((b) => b._id);

    if (bundleIds.length > 0) {
      await Bundle.updateMany(
        { _id: { $in: bundleIds } },
        { isActive: true },
      );

      // Reactivate storefront pricing for these bundles
      await StorefrontPricing.updateMany(
        { bundleId: { $in: bundleIds } },
        { isActive: true },
      );
    }

    logger.info(
      `[ProviderService] Reactivated ${bundleIds.length} bundle(s) and their storefront pricing for provider ${providerCode}`,
    );
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
      
      // Cascade deactivation before soft-delete
      await this._cascadeProviderDeactivation(provider, userId);
      
      // Also soft-delete associated packages
      await Package.updateMany(
        { provider: provider.code, isDeleted: false },
        { isDeleted: true, deletedAt: new Date(), deletedBy: userId, isActive: false, updatedBy: userId },
      );
      
      // Also soft-delete associated bundles
      await Bundle.updateMany(
        { providerId: provider._id, isDeleted: false },
        { isDeleted: true, deletedAt: new Date(), deletedBy: userId, isActive: false },
      );
      
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
