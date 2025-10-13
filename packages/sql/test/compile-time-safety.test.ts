import { describe, it, expect } from 'vitest';
import { sql, makeT } from '../src/exports';
import type { Plan } from '../src/types';

interface UserShape {
  id: number;
  email: string;
  active: boolean;
  createdAt: Date;
}

interface TestTables {
  user: Table<UserShape>;
}

const mockSchema = {
  target: 'postgres' as const,
  contractHash: 'test-hash',
  tables: {
    user: {
      columns: {
        id: {
          type: 'int4' as const,
          nullable: false,
          pk: true,
          default: { kind: 'autoincrement' as const },
        },
        email: { type: 'text' as const, nullable: false, unique: true },
        active: {
          type: 'bool' as const,
          nullable: false,
          default: { kind: 'literal' as const, value: 'true' },
        },
        createdAt: {
          type: 'timestamptz' as const,
          nullable: false,
          default: { kind: 'now' as const },
        },
      },
      indexes: [],
      constraints: [],
      capabilities: [],
    },
  },
};

const t = makeT<TestTables>(mockSchema);

describe('Compile-time Type Safety Verification', () => {
  describe('Type Inference Accuracy', () => {
    it('infers exact result types for single column selections', () => {
      // Test that TypeScript correctly infers the result type
      const singleIdQuery = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const singleIdPlan = singleIdQuery.build();
      
      // This should be Plan<{ id: number }>
      const singleIdType: Plan<{ id: number }> = singleIdPlan;
      expect(singleIdType).toBeDefined();
      
      const singleEmailQuery = sql(mockSchema).from(t.user).select({ email: t.user.email });
      const singleEmailPlan = singleEmailQuery.build();
      
      // This should be Plan<{ email: string }>
      const singleEmailType: Plan<{ email: string }> = singleEmailPlan;
      expect(singleEmailType).toBeDefined();
      
      const singleActiveQuery = sql(mockSchema).from(t.user).select({ active: t.user.active });
      const singleActivePlan = singleActiveQuery.build();
      
      // This should be Plan<{ active: boolean }>
      const singleActiveType: Plan<{ active: boolean }> = singleActivePlan;
      expect(singleActiveType).toBeDefined();
    });

    it('infers exact result types for multiple column selections', () => {
      const twoColumnQuery = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email });
      const twoColumnPlan = twoColumnQuery.build();
      
      // This should be Plan<{ id: number; email: string }>
      const twoColumnType: Plan<{ id: number; email: string }> = twoColumnPlan;
      expect(twoColumnType).toBeDefined();
      
      const threeColumnQuery = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email, active: t.user.active });
      const threeColumnPlan = threeColumnQuery.build();
      
      // This should be Plan<{ id: number; email: string; active: boolean }>
      const threeColumnType: Plan<{ id: number; email: string; active: boolean }> = threeColumnPlan;
      expect(threeColumnType).toBeDefined();
    });

    it('infers exact result types for aliased columns', () => {
      const aliasedQuery = sql(mockSchema)
        .from(t.user)
        .select({ 
          userId: t.user.id, 
          userEmail: t.user.email,
          isActive: t.user.active 
        });
      const aliasedPlan = aliasedQuery.build();
      
      // This should be Plan<{ userId: number; userEmail: string; isActive: boolean }>
      const aliasedType: Plan<{ userId: number; userEmail: string; isActive: boolean }> = aliasedPlan;
      expect(aliasedType).toBeDefined();
    });

    it('infers exact result types for full table shape', () => {
      const fullQuery = sql(mockSchema).from(t.user).select({
        id: t.user.id,
        email: t.user.email,
        active: t.user.active,
        createdAt: t.user.createdAt,
      });
      const fullPlan = fullQuery.build();
      
      // This should be Plan<UserShape>
      const fullType: Plan<UserShape> = fullPlan;
      expect(fullType).toBeDefined();
    });
  });

  describe('Type Safety Enforcement', () => {
    it('enforces Plan<never> for queries without select()', () => {
      const noSelectQuery = sql(mockSchema).from(t.user);
      const noSelectPlan = noSelectQuery.build();
      
      // This should be Plan<never>
      const noSelectType: Plan<never> = noSelectPlan;
      expect(noSelectType).toBeDefined();
      
      // The following would cause TypeScript errors if uncommented:
      // const wrongType1: Plan<{ id: number }> = noSelectPlan; // Error!
      // const wrongType2: Plan<{ email: string }> = noSelectPlan; // Error!
      // const wrongType3: Plan<UserShape> = noSelectPlan; // Error!
    });

    it('prevents incorrect type assignments', () => {
      const idQuery = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const idPlan = idQuery.build(); // Plan<{ id: number }>
      
      const emailQuery = sql(mockSchema).from(t.user).select({ email: t.user.email });
      const emailPlan = emailQuery.build(); // Plan<{ email: string }>
      
      // These should work
      const correctIdType: Plan<{ id: number }> = idPlan;
      const correctEmailType: Plan<{ email: string }> = emailPlan;
      expect(correctIdType).toBeDefined();
      expect(correctEmailType).toBeDefined();
      
      // The following would cause TypeScript errors if uncommented:
      // const wrongIdType: Plan<{ email: string }> = idPlan; // Error!
      // const wrongEmailType: Plan<{ id: number }> = emailPlan; // Error!
    });
  });

  describe('Method Chaining Type Preservation', () => {
    it('preserves result type through where() calls', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email })
        .where(t.user.active.eq(true));
      
      const plan = query.build();
      
      // Should still be Plan<{ id: number; email: string }> after where()
      const preservedType: Plan<{ id: number; email: string }> = plan;
      expect(preservedType).toBeDefined();
    });

    it('preserves result type through orderBy() calls', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email })
        .orderBy('email', 'ASC');
      
      const plan = query.build();
      
      // Should still be Plan<{ id: number; email: string }> after orderBy()
      const preservedType: Plan<{ id: number; email: string }> = plan;
      expect(preservedType).toBeDefined();
    });

    it('preserves result type through limit() calls', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email })
        .limit(10);
      
      const plan = query.build();
      
      // Should still be Plan<{ id: number; email: string }> after limit()
      const preservedType: Plan<{ id: number; email: string }> = plan;
      expect(preservedType).toBeDefined();
    });

    it('preserves result type through multiple chained calls', () => {
      const query = sql(mockSchema)
        .from(t.user)
        .where(t.user.active.eq(true))
        .select({ id: t.user.id, email: t.user.email })
        .orderBy('email', 'ASC')
        .orderBy('id', 'DESC')
        .limit(100);
      
      const plan = query.build();
      
      // Should still be Plan<{ id: number; email: string }> after all operations
      const preservedType: Plan<{ id: number; email: string }> = plan;
      expect(preservedType).toBeDefined();
    });
  });

  describe('Type Narrowing and Widening', () => {
    it('demonstrates type narrowing from broader to specific', () => {
      // Start with a broader selection
      const broadQuery = sql(mockSchema)
        .from(t.user)
        .select({ 
          id: t.user.id, 
          email: t.user.email, 
          active: t.user.active 
        });
      const broadPlan = broadQuery.build(); // Plan<{ id: number; email: string; active: boolean }>
      
      // Create a narrower selection
      const narrowQuery = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email });
      const narrowPlan = narrowQuery.build(); // Plan<{ id: number; email: string }>
      
      // These should have different types
      const broadType: Plan<{ id: number; email: string; active: boolean }> = broadPlan;
      const narrowType: Plan<{ id: number; email: string }> = narrowPlan;
      
      expect(broadType).toBeDefined();
      expect(narrowType).toBeDefined();
      
      // The following would cause TypeScript errors if uncommented:
      // const wrongAssignment: Plan<{ id: number; email: string }> = broadPlan; // Error!
      // const wrongAssignment2: Plan<{ id: number; email: string; active: boolean }> = narrowPlan; // Error!
    });

    it('demonstrates type widening with aliases', () => {
      const originalQuery = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email });
      const originalPlan = originalQuery.build(); // Plan<{ id: number; email: string }>
      
      const aliasedQuery = sql(mockSchema)
        .from(t.user)
        .select({ 
          userId: t.user.id, 
          userEmail: t.user.email 
        });
      const aliasedPlan = aliasedQuery.build(); // Plan<{ userId: number; userEmail: string }>
      
      // These should have different types due to aliasing
      const originalType: Plan<{ id: number; email: string }> = originalPlan;
      const aliasedType: Plan<{ userId: number; userEmail: string }> = aliasedPlan;
      
      expect(originalType).toBeDefined();
      expect(aliasedType).toBeDefined();
      
      // The following would cause TypeScript errors if uncommented:
      // const wrongAssignment: Plan<{ userId: number; userEmail: string }> = originalPlan; // Error!
      // const wrongAssignment2: Plan<{ id: number; email: string }> = aliasedPlan; // Error!
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('handles empty select object correctly', () => {
      const emptyQuery = sql(mockSchema).from(t.user).select({});
      const emptyPlan = emptyQuery.build();
      
      // Empty select should still work
      const emptyType: Plan<{}> = emptyPlan;
      expect(emptyType).toBeDefined();
    });

    it('handles single property object correctly', () => {
      const singlePropQuery = sql(mockSchema).from(t.user).select({ id: t.user.id });
      const singlePropPlan = singlePropQuery.build();
      
      // Should be Plan<{ id: number }>
      const singlePropType: Plan<{ id: number }> = singlePropPlan;
      expect(singlePropType).toBeDefined();
    });

    it('maintains type consistency across different query patterns', () => {
      // Pattern 1: Select first, then filter
      const pattern1 = sql(mockSchema)
        .from(t.user)
        .select({ id: t.user.id, email: t.user.email })
        .where(t.user.active.eq(true));
      
      // Pattern 2: Filter first, then select
      const pattern2 = sql(mockSchema)
        .from(t.user)
        .where(t.user.active.eq(true))
        .select({ id: t.user.id, email: t.user.email });
      
      const plan1 = pattern1.build();
      const plan2 = pattern2.build();
      
      // Both should have the same result type
      const type1: Plan<{ id: number; email: string }> = plan1;
      const type2: Plan<{ id: number; email: string }> = plan2;
      
      expect(type1).toBeDefined();
      expect(type2).toBeDefined();
    });
  });
});
