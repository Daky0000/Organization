// Post model
module.exports = (sequelize, DataTypes) => {
  const Post = sequelize.define('Post', {
    connected_account_id: { type: DataTypes.INTEGER, allowNull: false },
    platform: { type: DataTypes.STRING },
    type: { type: DataTypes.STRING },
    content: { type: DataTypes.JSONB },
    media: { type: DataTypes.JSONB },
    status: { type: DataTypes.STRING, defaultValue: 'pending' },
    scheduledAt: { type: DataTypes.DATE },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    platformResponse: { type: DataTypes.JSONB },
    errorLog: { type: DataTypes.TEXT }
  }, { tableName: 'posts', timestamps: false });
  Post.associate = models => {
    Post.belongsTo(models.ConnectedAccount, { foreignKey: 'connected_account_id' });
  };
  return Post;
};