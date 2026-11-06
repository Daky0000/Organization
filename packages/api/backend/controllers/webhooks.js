// Webhook Listener Controller
const { ConnectedAccount } = require('../models/ConnectedAccount');
const { notifyUser } = require('../utils/notify');

class WebhookListener {
  static async handleEvent(event) {
    switch(event.type) {
      case 'permissions_revoked':
      case 'deauthorized':
        await ConnectedAccount.update({ status: 'inactive' }, { where: { provider_user_id: event.user_id } });
        notifyUser(event.user_id, 'Your connection has been deauthorized.');
        break;
      default:
        console.log('Unhandled webhook event', event);
    }
  }
}
module.exports = WebhookListener;