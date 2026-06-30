// src/services/packageService.js
import Package from "../models/Package.js";
import Bundle from "../models/Bundle.js";
import StorefrontPricing from "../models/StorefrontPricing.js";
import Provider from "../models/Provider.js";
import logger from "../utils/logger.js";
import { toPublicPackage, toAdminPackage, pickPackage } from "../utils/dto.js";

class PackageService {
  // Create a new package
  async createPackage(packageData) {
    try {
      // Validate provider exists and is active
      const providerExists = await Provider.exists({
        code: packageData.provider,
        isDeleted: false,
        isActive: true,
      });

      if (!providerExists) {
        throw new Error(
          `Provider ${packageData.provider} does not exist or is inactive`,
        );
      }

      const packageGroup = new Package(packageData);
      await packageGroup.save();

      logger.info(
        `Package created: ${packageGroup._id} by user ${packageData.createdBy}`,
      );
      return toAdminPackage(packageGroup.toObject ? packageGroup.toObject() : packageGroup);
    } catch (error) {
      logger.error(`Package creation failed: ${error.message}`);
      throw error;
    }
  }

  // Get packages with filtering and pagination
  async getPackages(filters = {}, pagination = {}, userType = "agent") {
    const {
      page = 1,
      limit = 20,
    } = pagination;
    const {
      search,
      provider,
      category,
      packageSlug,
      packageName,
      isActive,
      includeDeleted = false,
    } = filters;

    const query = {};

    if (!includeDeleted) {
      query.isDeleted = false;
    }

    if (provider) query.provider = provider;
    if (isActive !== undefined) query.isActive = isActive;

    if (packageSlug) {
      const normalizedSlug = packageSlug.toString().trim().toLowerCase();
      const phrase = normalizedSlug.replace(/[-_]+/g, " ");
      query.$or = [
        { slug: normalizedSlug },
        { category: normalizedSlug },
        { name: { $regex: new RegExp(phrase.replace(/\s+/g, "\\s+"), "i") } },
      ];
    } else {
      if (category) query.category = category;
      if (packageName) {
        const phrase = packageName.toString().trim().replace(/[-_]+/g, " ");
        query.name = {
          $regex: new RegExp(phrase.replace(/\s+/g, "\\s+"), "i"),
        };
      }
    }

    if (search) {
      query.$or = query.$or
        ? query.$or.concat([
            { name: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ])
        : [
            { name: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ];
    }

    const [allPackages, total] = await Promise.all([
      Package.find(query)
        .populate("createdBy", "fullName email")
        .populate("updatedBy", "fullName email")
        .lean(),
      Package.countDocuments(query),
    ]);

    const providerPriority = { MTN: 1, TELECEL: 2, AT: 3, AFA: 4 };
    allPackages.sort((a, b) => {
      const priA = providerPriority[a.provider] ?? 999;
      const priB = providerPriority[b.provider] ?? 999;
      if (priA !== priB) return priA - priB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const skip = (page - 1) * limit;
    const packages = allPackages.slice(skip, skip + Number(limit));

    return {
      packages: packages.map((p) => pickPackage(p, userType)),
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / limit),
        limit: Number(limit),
      },
    };
  }

  // Get single package by ID
  async getPackageById(packageId, userType = "agent") {
    const packageGroup = await Package.findOne({
      _id: packageId,
      isDeleted: false,
    })
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    if (!packageGroup) {
      throw new Error("Package not found");
    }

    return pickPackage(packageGroup, userType);
  }

  // Get single package by stable slug or package name
  async getPackageBySlug(packageSlug, userType = "agent") {
    const normalizedSlug = packageSlug.toString().trim().toLowerCase();
    const slugPattern = new RegExp(
      normalizedSlug.replace(/[-_]+/g, "\\s*"),
      "i",
    );

    const packageGroup = await Package.findOne({
      isDeleted: false,
      $or: [
        { slug: normalizedSlug },
        { category: normalizedSlug },
        { name: { $regex: slugPattern } },
      ],
    })
      .populate("createdBy", "fullName email")
      .populate("updatedBy", "fullName email");

    if (!packageGroup) {
      throw new Error("Package not found");
    }

    return pickPackage(packageGroup, userType);
  }

  // Update package
  async updatePackage(packageId, updateData, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: false,
    };

    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }

    const packageGroup = await Package.findOne(query);

    if (!packageGroup) {
      throw new Error("Package not found");
    }

    // Validate provider if being updated
    if (updateData.provider) {
      const providerExists = await Provider.exists({
        code: updateData.provider,
        isDeleted: false,
        isActive: true,
      });

      if (!providerExists) {
        throw new Error(
          `Provider ${updateData.provider} does not exist or is inactive`,
        );
      }
    }

    // ── Cascade deactivation when package is turned off ─────────────────────
    if (updateData.isActive === false && packageGroup.isActive !== false) {
      await this._cascadePackageDeactivation(packageId, userId);
    }

    // ── Cascade reactivation when package is turned on ──────────────────────
    if (updateData.isActive === true && packageGroup.isActive !== true) {
      await this._cascadePackageReactivation(packageId, userId);
    }

    updateData.updatedBy = userId;
    Object.assign(packageGroup, updateData);
    await packageGroup.save();

    logger.info(`Package updated: ${packageId} by user ${userId}`);
    return toAdminPackage(packageGroup.toObject ? packageGroup.toObject() : packageGroup);
  }

  // REFACTOR TODO: Remove cascade to bundles/storefront-pricing once bundle queries
  // check parent Package.isActive at query time (bundleService, storefrontService).
  // When that's done, this method should be a no-op (packages stand alone).
  async _cascadePackageDeactivation(packageId, userId) {
    const bundles = await Bundle.find({ packageId, isDeleted: false }).select('_id');
    const bundleIds = bundles.map((b) => b._id);

    if (bundleIds.length > 0) {
      await Bundle.updateMany(
        { _id: { $in: bundleIds } },
        { isActive: false },
      );

      await StorefrontPricing.updateMany(
        { bundleId: { $in: bundleIds } },
        { isActive: false },
      );
    }

    logger.info(
      `[PackageService] Deactivated ${bundleIds.length} bundle(s) and their storefront pricing for package ${packageId}`,
    );
  }

  async _cascadePackageReactivation(packageId, userId) {
    const bundles = await Bundle.find({ packageId, isDeleted: false }).select('_id');
    const bundleIds = bundles.map((b) => b._id);

    if (bundleIds.length > 0) {
      await Bundle.updateMany(
        { _id: { $in: bundleIds } },
        { isActive: true },
      );

      await StorefrontPricing.updateMany(
        { bundleId: { $in: bundleIds } },
        { isActive: true },
      );
    }

    logger.info(
      `[PackageService] Reactivated ${bundleIds.length} bundle(s) and their storefront pricing for package ${packageId}`,
    );
  }

  // Soft delete package
  async deletePackage(packageId, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: false,
    };

    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }

    const packageGroup = await Package.findOne(query);

    if (!packageGroup) {
      throw new Error("Package not found");
    }

    // Cascade deactivation before soft-delete
    await this._cascadePackageDeactivation(packageId, userId);

    // Also soft-delete associated bundles
    await Bundle.updateMany(
      { packageId, isDeleted: false },
      { isDeleted: true, deletedAt: new Date(), deletedBy: userId, isActive: false },
    );

    await packageGroup.softDelete(userId);
    logger.info(`Package deleted: ${packageId} by user ${userId}`);
    return toAdminPackage(packageGroup.toObject ? packageGroup.toObject() : packageGroup);
  }

  // Restore package
  async restorePackage(packageId, tenantId, userId) {
    // For super admins, don't filter by tenantId
    const query = {
      _id: packageId,
      isDeleted: true,
    };

    // Only filter by tenantId for non-super admin users
    if (tenantId) {
      query.tenantId = tenantId;
    }

    const packageGroup = await Package.findOne(query);

    if (!packageGroup) {
      throw new Error("Package not found");
    }

    await packageGroup.restore();
    logger.info(`Package restored: ${packageId} by user ${userId}`);
    return toAdminPackage(packageGroup.toObject ? packageGroup.toObject() : packageGroup);
  }

  // Get packages by provider
  async getPackagesByProvider(provider, userType = "agent") {
    const packages = await Package.find({
      provider,
      isActive: true,
      isDeleted: false,
    }).populate("createdBy", "fullName email");

    return packages.map((p) => pickPackage(p, userType));
  }

  // Get packages by category
  async getPackagesByCategory(category, userType = "agent") {
    const packages = await Package.find({
      category,
      isActive: true,
      isDeleted: false,
    }).populate("createdBy", "fullName email").lean();

    const providerPriority = { MTN: 1, TELECEL: 2, AT: 3, AFA: 4 };
    packages.sort((a, b) => {
      const priA = providerPriority[a.provider] ?? 999;
      const priB = providerPriority[b.provider] ?? 999;
      if (priA !== priB) return priA - priB;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return packages.map((p) => pickPackage(p, userType));
  }

  // Get package statistics
  async getPackageStats() {
    const stats = await Package.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalPackages: { $sum: 1 },
          activePackages: {
            $sum: { $cond: ["$isActive", 1, 0] },
          },
          providerStats: {
            $push: {
              provider: "$provider",
              category: "$category",
              isActive: "$isActive",
            },
          },
        },
      },
    ]);

    if (stats.length === 0) {
      return {
        totalPackages: 0,
        activePackages: 0,
        providerStats: [],
      };
    }

    const result = stats[0];

    // Group by provider
    const providerGroups = {};
    result.providerStats.forEach((stat) => {
      if (!providerGroups[stat.provider]) {
        providerGroups[stat.provider] = { total: 0, active: 0 };
      }
      providerGroups[stat.provider].total++;
      if (stat.isActive) providerGroups[stat.provider].active++;
    });

    result.providerStats = Object.entries(providerGroups).map(
      ([provider, counts]) => ({
        provider,
        totalPackages: counts.total,
        activePackages: counts.active,
      }),
    );

    return result;
  }
}

export default new PackageService();
