class AuthService {
  constructor() {
    this.token = null;
    this.user = null;
    this.refreshTimeout = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return !!this.token;

    try {
      let stored = await chrome.storage.session.get([
        "supabase_session",
        "supabase_user",
        "session_expires_at",
      ]);

      // If not in session storage, check local storage (for existing users)
      if (!stored.supabase_session) {
        stored = await chrome.storage.local.get([
          "supabase_session",
          "supabase_user",
          "session_expires_at",
        ]);
      }

      if (!stored.supabase_session) {
        this.initialized = true;
        return false;
      }

      const expiresAt = stored.session_expires_at
        ? new Date(stored.session_expires_at)
        : null;

      if (expiresAt && expiresAt > new Date()) {
        this.token = stored.supabase_session;
        this.user = stored.supabase_user;
        this.scheduleTokenRefresh(expiresAt);
        this.initialized = true;
        return true;
      }

      await this.refreshSession();
      this.initialized = true;
      return !!this.token;
    } catch (error) {
      await this.logout();
      this.initialized = true;
      return false;
    }
  }

  async register(email, password) {
    try {
      const response = await fetch(
        `${EXT_CONFIG.SUPABASE_URL}/auth/v1/signup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email,
            password,
            options: {
              data: {
                registered_via: "extension",
                registered_at: new Date().toISOString(),
              },
            },
          }),
        }
      );

      const data = await response.json();

      if (data.error) {
        return {
          success: false,
          error: this.formatError(data.error.message),
        };
      }

      if (data.access_token) {
        await this.saveSession(data);
        return { success: true, user: data.user, requiresConfirmation: false };
      }

      return {
        success: true,
        requiresConfirmation: true,
        message: "Please check your email to confirm your account.",
      };
    } catch (error) {
      return {
        success: false,
        error: "Network error. Please check your connection.",
      };
    }
  }

  async login(email, password) {
    try {
      const response = await fetch(
        `${EXT_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password }),
        }
      );

      const data = await response.json();

      if (data.error) {
        return {
          success: false,
          error: this.formatError(data.error.message),
        };
      }

      await this.saveSession(data);
      return { success: true, user: data.user };
    } catch (error) {
      return {
        success: false,
        error: "Network error. Please check your connection.",
      };
    }
  }

  async logout() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    try {
      if (this.token && navigator.onLine) {
        await fetch(`${EXT_CONFIG.SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
          },
        });
      }
    } catch (error) {}

    // Clear from both session and local storage
    const keys = [
      "supabase_session",
      "supabase_user",
      "session_expires_at",
      "refresh_token",
    ];
    await chrome.storage.session.remove(keys);
    await chrome.storage.local.remove(keys);

    this.token = null;
    this.user = null;
  }
  async saveSession(data) {
    this.token = data.access_token;
    this.user = data.user;

    const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
    const sessionData = {
      supabase_session: data.access_token,
      supabase_user: data.user,
      session_expires_at: expiresAt.toISOString(),
      refresh_token: data.refresh_token,
    };

    // Store in session storage (secure, cleared on browser close)
    await chrome.storage.session.set(sessionData);
    // Keep in local storage for backwards compatibility during migration
    await chrome.storage.local.set(sessionData);

    this.scheduleTokenRefresh(expiresAt);
  }

  scheduleTokenRefresh(expiresAt) {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    const refreshTime = expiresAt.getTime() - Date.now() - 5 * 60 * 1000;

    if (refreshTime > 0) {
      this.refreshTimeout = setTimeout(() => {
        this.refreshSession();
      }, refreshTime);
    }
  }

  async refreshSession() {
    if (!navigator.onLine) {
      return false;
    }
    try {
      // Try session storage first, fall back to local storage
      let stored = await chrome.storage.session.get(["refresh_token"]);
      if (!stored.refresh_token) {
        stored = await chrome.storage.local.get(["refresh_token"]);
      }

      if (!stored.refresh_token) {
        await this.logout();
        return false;
      }

      const response = await fetch(
        `${EXT_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            refresh_token: stored.refresh_token,
          }),
        }
      );

      const data = await response.json();

      if (data.error || !data.access_token) {
        await this.logout();
        return false;
      }

      await this.saveSession(data);
      return true;
    } catch (error) {
      if (!navigator.onLine) {
        return false;
      }
      return false;
    }
  }

  async verifyToken() {
    if (!this.token) return false;

    try {
      const response = await fetch(`${EXT_CONFIG.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
        },
      });

      if (!response.ok) {
        await this.refreshSession();
        return !!this.token;
      }

      return true;
    } catch {
      return false;
    }
  }

  getAuthHeader() {
    return this.token ? `Bearer ${this.token}` : null;
  }

  formatError(message) {
    const errorMap = {
      "Invalid login credentials": "Invalid email or password",
      "Email not confirmed": "Please confirm your email before logging in",
      "User already registered": "This email is already registered",
      "Password should be at least 6 characters":
        "Password must be at least 6 characters",
    };

    return errorMap[message] || message;
  }

  validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  }

  validatePassword(password) {
    if (password.length < 8) {
      return { valid: false, error: "Password must be at least 8 characters" };
    }
    if (!/[A-Z]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one uppercase letter",
      };
    }
    if (!/[a-z]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one lowercase letter",
      };
    }
    if (!/[0-9]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one number",
      };
    }
    if (!/[@$!%*?&]/.test(password)) {
      return {
        valid: false,
        error: "Password must contain at least one symbol (@$!%*?&)",
      };
    }
    return { valid: true };
  }

  async migrateToSessionStorage() {
    try {
      const stored = await chrome.storage.local.get([
        "supabase_session",
        "supabase_user",
        "session_expires_at",
        "refresh_token",
      ]);
      if (stored.supabase_session) {
        await chrome.storage.session.set({
          supabase_session: stored.supabase_session,
          supabase_user: stored.supabase_user,
          session_expires_at: stored.session_expires_at,
          refresh_token: stored.refresh_token,
        });
      }
    } catch (error) {
      //...
    }
  }
}

const authService = new AuthService();
