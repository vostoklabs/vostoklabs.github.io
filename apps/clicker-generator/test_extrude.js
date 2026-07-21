import wasm from 'manifold-3d';
wasm().then(manifold => {
  manifold.setup();
  const { Manifold, CrossSection } = manifold;
  const cs = CrossSection.square([10, 10]);
  try {
    const cs_trans = cs.translate([5, 5]);
    console.log("CrossSection.translate succeeded");
    
    // Test scaleTop = [0, 0]
    try {
      const s_zero = Manifold.extrude(cs_trans, 1, 0, 0, [0, 0]);
      console.log("extrude with scaleTop = [0, 0] succeeded");
    } catch (e) {
      console.log("extrude with scaleTop = [0, 0] failed:", e.message);
    }

    // Test scaleTop = [-0.1, -0.1]
    try {
      const s_neg = Manifold.extrude(cs_trans, 1, 0, 0, [-0.1, -0.1]);
      console.log("extrude with scaleTop = [-0.1, -0.1] succeeded");
    } catch (e) {
      console.log("extrude with scaleTop = [-0.1, -0.1] failed:", e.message);
    }

  } catch (e) {
    console.log("test failed:", e.message);
  }
});




