import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { PricingPlan, CreatePricingPlanInput } from '../../types/pricing';
import { pricingService } from '../../services/pricingService';

const PricingManagement = () => {
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreatePricingPlanInput & { id?: string; isActive?: boolean }>({
    name: '',
    description: '',
    price: 0,
    billingPeriod: 'monthly',
    features: [],
    discountPercentage: 0,
    isOnSale: false,
  });

  const [newFeature, setNewFeature] = useState('');

  const fetchPlans = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const data = await pricingService.getPlans();
      setPlans(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load pricing plans');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPlans();
  }, []);

  const handleAddFeature = () => {
    if (newFeature.trim()) {
      setFormData((prev) => ({
        ...prev,
        features: [...prev.features, newFeature.trim()],
      }));
      setNewFeature('');
    }
  };

  const handleRemoveFeature = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.description.trim()) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    try {
      setErrorMessage(null);
      if (editingId) {
        await pricingService.updatePlan(editingId, {
          name: formData.name,
          description: formData.description,
          price: formData.price,
          billingPeriod: formData.billingPeriod,
          features: formData.features,
          isActive: formData.isActive ?? true,
          discountPercentage: formData.discountPercentage ?? 0,
          isOnSale: formData.isOnSale ?? false,
        });
        setSuccessMessage('Pricing plan updated successfully');
      } else {
        await pricingService.createPlan(formData);
        setSuccessMessage('Pricing plan created successfully');
      }
      setIsFormOpen(false);
      setEditingId(null);
      setFormData({ name: '', description: '', price: 0, billingPeriod: 'monthly', features: [], discountPercentage: 0, isOnSale: false });
      await fetchPlans();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save pricing plan');
    }
  };

  const handleEdit = (plan: PricingPlan) => {
    setEditingId(plan.id);
    setFormData({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      billingPeriod: plan.billingPeriod,
      features: [...plan.features],
      isActive: plan.isActive,
      discountPercentage: plan.discountPercentage ?? 0,
      isOnSale: plan.isOnSale ?? false,
    });
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this pricing plan?')) return;

    try {
      setErrorMessage(null);
      await pricingService.deletePlan(id);
      setSuccessMessage('Pricing plan deleted successfully');
      await fetchPlans();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete pricing plan');
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      setErrorMessage(null);
      await pricingService.togglePlanStatus(id, !currentStatus);
      setSuccessMessage(`Pricing plan ${!currentStatus ? 'activated' : 'deactivated'}`);
      await fetchPlans();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to update plan status');
    }
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({ name: '', description: '', price: 0, billingPeriod: 'monthly', features: [], discountPercentage: 0, isOnSale: false });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Pricing Plans</h1>
          <p className="mt-1 text-slate-600">Manage your subscription pricing and features</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', description: '', price: 0, billingPeriod: 'monthly', features: [], discountPercentage: 0, isOnSale: false });
            setIsFormOpen(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Plus size={18} />
          Add Pricing Plan
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {isFormOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-950">
            {editingId ? 'Edit Pricing Plan' : 'Create Pricing Plan'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Plan Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Starter, Professional"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Price
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                    placeholder="0"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    value={formData.billingPeriod}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        billingPeriod: e.target.value as 'monthly' | 'yearly',
                      })
                    }
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe this pricing plan"
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Discount / Sale */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-3 text-sm font-bold text-amber-800">Discount / Sale</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Discount %
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={formData.discountPercentage ?? 0}
                    onChange={(e) => setFormData({ ...formData, discountPercentage: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {formData.discountPercentage ? `Original price shown as crossed-out, discounted price shown` : 'Enter % to show a crossed-out original price'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Mark as "On Sale"
                  </label>
                  <label className="flex cursor-pointer items-center gap-3">
                    <div className="relative">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={formData.isOnSale ?? false}
                        onChange={(e) => setFormData({ ...formData, isOnSale: e.target.checked })}
                      />
                      <div className={`h-6 w-11 rounded-full transition-colors ${formData.isOnSale ? 'bg-amber-500' : 'bg-slate-300'}`} />
                      <div className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${formData.isOnSale ? 'translate-x-5' : ''}`} />
                    </div>
                    <span className="text-sm font-medium text-slate-700">
                      {formData.isOnSale ? 'On Sale badge shown' : 'No badge'}
                    </span>
                  </label>
                  <p className="mt-1 text-xs text-slate-500">Shows a prominent "Sale" badge on the plan card</p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Features
              </label>
              <div className="space-y-2 mb-3">
                {formData.features.map((feature, index) => (
                  <div key={index} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-700">{feature}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFeature(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())}
                  placeholder="Add a feature and press Enter"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddFeature}
                  className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {editingId ? 'Update Plan' : 'Create Plan'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="text-slate-600">Loading pricing plans...</div>
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
          <div className="text-slate-600">No pricing plans yet. Create one to get started.</div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl border p-6 transition-colors ${
                plan.isActive
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-slate-200 bg-slate-50 opacity-60'
              }`}
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">{plan.name}</h3>
                  <p className="mt-1 text-2xl font-black text-slate-950">
                    ${plan.price}
                    <span className="text-sm font-semibold text-slate-600">/{plan.billingPeriod}</span>
                  </p>
                </div>
                <button
                  onClick={() => handleToggleStatus(plan.id, plan.isActive)}
                  className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                    plan.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {plan.isActive ? 'Active' : 'Inactive'}
                </button>
              </div>

              <p className="mb-4 text-sm text-slate-600">{plan.description}</p>

              <div className="mb-4 space-y-2">
                {plan.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="text-green-600">✓</span>
                    {feature}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-4 border-t border-slate-200">
                <button
                  onClick={() => handleEdit(plan)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  <Edit2 size={16} />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PricingManagement;
