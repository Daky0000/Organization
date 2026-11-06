// AuditLog model
module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    user_id: { type: DataTypes.INTEGER, allowNull: false },
    action: { type: DataTypes.STRING },
    metadata: { type: DataTypes.JSONB },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  }, { tableName: 'audit_logs', timestamps: false });
  AuditLog.associate = models => {
    AuditLog.belongsTo(models.User, { foreignKey: 'user_id' });
  };
  return AuditLog;
};