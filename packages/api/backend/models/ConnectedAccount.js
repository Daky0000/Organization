// ConnectedAccount model
module.exports = (sequelize, DataTypes) => {
  const ConnectedAccount = sequelize.define('ConnectedAccount', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    provider: { type: DataTypes.STRING },
    provider_user_id: { type: DataTypes.STRING },
    token_type: { type: DataTypes.STRING },
    access_token: { type: DataTypes.TEXT },
    refresh_token: { type: DataTypes.TEXT },
    page_id: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING, defaultValue: 'active' },
    expires_at: { type: DataTypes.DATE },
    needsReapproval: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { tableName: 'connected_accounts', timestamps: false });
  ConnectedAccount.associate = models => {
    ConnectedAccount.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return ConnectedAccount;
};