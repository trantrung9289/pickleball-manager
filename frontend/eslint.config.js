import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Cho phép pattern `const { key1, key2, ...rest } = obj` để loại field trước khi
      // gửi payload (dùng ở Tournament.jsx, Transactions.jsx) mà không cần cố dùng biến đó.
      // varsIgnorePattern/argsIgnorePattern: tiền tố `_` báo hiệu "cố ý không dùng".
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
    },
  },
  {
    // File cấu hình Vite chạy trong Node, không phải trình duyệt
    files: ['vite.config.js'],
    languageOptions: { globals: globals.node },
  },
])
