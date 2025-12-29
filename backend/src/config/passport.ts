import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User, IUser, UserRole } from '../models/User';

// Configure Local Strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password'
    },
    async (email, password, done) => {
      try {
        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        // Check if user is active
        if (!user.isActive) {
          return done(null, false, { message: 'Account is deactivated' });
        }

        // Verify password
        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

// Configure Google OAuth2 Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback'
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Check if user already exists with this Google ID
          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            // User exists, check if active
            if (!user.isActive) {
              return done(null, false, { message: 'Account is deactivated' });
            }
            // Update authProvider if not already set
            if (!user.authProvider || user.authProvider === 'local') {
              user.authProvider = 'google';
              await user.save();
            }
            return done(null, user);
          }

          // Check if user exists with this email
          const email = profile.emails?.[0]?.value;
          if (email) {
            user = await User.findOne({ email: email.toLowerCase() });

            if (user) {
              // Link Google account to existing user
              user.googleId = profile.id;
              user.authProvider = 'google';
              await user.save();
              return done(null, user);
            }
          }

          // Create new user
          const newUser = new User({
            googleId: profile.id,
            email: email?.toLowerCase(),
            firstName: profile.name?.givenName || profile.displayName || 'User',
            lastName: profile.name?.familyName || '',
            role: UserRole.HYBRID,
            authProvider: 'google',
            isActive: true
          });

          await newUser.save();
          return done(null, newUser);
        } catch (error) {
          return done(error as Error);
        }
      }
    )
  );
}

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;
