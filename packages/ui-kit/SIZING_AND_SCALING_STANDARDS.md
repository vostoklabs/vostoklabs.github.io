# Vostok Labs Sizing and Scaling Standards

As per standard design patterns established in the **Clicker Generator**, the following sizing and scaling rules apply across all Vostok Labs web tools to maintain a consistent 1-to-1 look and feel.

## Application Layout (Grid)

The main application layout uses a 3-column CSS Grid to define the left sidebar, the central 3D viewport, and the right sidebar. The width of the left panel is locked to `22vw`, and the right panel is `24.2vw` (10% wider than the left) to maintain comfortable proportions.

```css
.app-container {
  display: grid;
  height: 100vh;
  /* Standard Layout: 22vw left menu, 1fr main viewport, 24.2vw right menu */
  grid-template-columns: 22vw 1fr 24.2vw;
  grid-template-rows: auto 1fr;
}
```

## Topbar
The topbar links and buttons share consistent dimensions.
- **Font Size**: 15px
- **Padding**: 6px 12px
- **Border Radius**: 9px
- **Background**: Transparent (by default, except for primary action buttons like License or MakerWorld Boost)

```css
.vl-topbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
```

## Sidebars
The sidebar sections are constrained by the `20vw` grid column. Inside the sidebars, content sections maintain standard padding and gaps.
- **Sidebar Padding**: 20px
- **Controls Gap/Rhythm**: 16px (or tighter depending on control density)

By adhering to these dimensions, our menus will be the exact same size across the Clicker Generator, Name Keychain Generator, and all future tools.
