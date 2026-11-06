#!/bin/bash
# Setup script for ContentFlow Connects module

echo "🎨 ContentFlow - Connects Module Setup"
echo "======================================"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check Node.js
echo -e "${BLUE}Checking Node.js installation...${NC}"
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+"
    exit 1
fi
echo "✅ Node.js $(node -v) installed"

# Install frontend dependencies
echo -e "\n${BLUE}Installing frontend dependencies...${NC}"
npm install
echo "✅ Frontend dependencies installed"

# Create .env file if it doesn't exist
if [ ! -f .env.local ]; then
    echo -e "\n${BLUE}Creating .env.local file...${NC}"
    cp .env.example .env.local
    echo "⚠️  Please update .env.local with your OAuth credentials"
else
    echo "✅ .env.local already exists"
fi

# Build check
echo -e "\n${BLUE}Checking build...${NC}"
npm run build
echo "✅ Build successful"

echo -e "\n${GREEN}✨ Setup complete!${NC}"
echo "Next steps:"
echo "1. Update .env.local with your OAuth credentials"
echo "2. Start backend: npx ts-node server.ts"
echo "3. Start frontend: npm run dev"
echo "4. Visit http://localhost:3000"
echo ""
echo "For detailed setup, see QUICK_START.md"
