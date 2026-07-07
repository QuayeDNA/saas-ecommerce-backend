import mongoose from "mongoose";

const knownMtnNumberSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  importedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("KnownMtnNumber", knownMtnNumberSchema);
