export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
  isActive: boolean;
  discountPercentage: number;
  isOnSale: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePricingPlanInput {
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
  discountPercentage?: number;
  isOnSale?: boolean;
}

export interface UpdatePricingPlanInput {
  name: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly';
  features: string[];
  isActive: boolean;
  discountPercentage?: number;
  isOnSale?: boolean;
}

export interface PricingPlanResponse {
  success: boolean;
  plan?: PricingPlan;
  plans?: PricingPlan[];
  error?: string;
}
