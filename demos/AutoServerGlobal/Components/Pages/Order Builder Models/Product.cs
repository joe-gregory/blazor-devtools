// ═══════════════════════════════════════════════════════════════════════════════
// BLAZOR DEVELOPER TOOLS - Product.cs
// ═══════════════════════════════════════════════════════════════════════════════
// Simple model for the Order Builder performance demo.
// Place this in your project's root or Models folder.
// Adjust namespace to match your project if needed.
// ═══════════════════════════════════════════════════════════════════════════════

namespace AutoServerGlobal.Components.Pages.Order_Builder_Models;

/// <summary>
/// Represents a product in the Order Builder demo.
/// </summary>
public class Product
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Emoji { get; set; } = "📦";
    public decimal Price { get; set; }
    public int Quantity { get; set; }

    public decimal Total => Price * Quantity;

    /// <summary>
    /// Default products for the demo.
    /// </summary>
    public static List<Product> GetDefaultProducts() =>
    [
        new() { Id = 1, Name = "Apples", Emoji = "🍎", Price = 2.99m, Quantity = 0 },
        new() { Id = 2, Name = "Oranges", Emoji = "🍊", Price = 3.49m, Quantity = 0 },
        new() { Id = 3, Name = "Lemons", Emoji = "🍋", Price = 1.99m, Quantity = 0 },
        new() { Id = 4, Name = "Grapes", Emoji = "🍇", Price = 4.99m, Quantity = 0 },
    ];

    /// <summary>
    /// Additional products that can be added dynamically.
    /// </summary>
    public static List<Product> GetAdditionalProducts() =>
    [
        new() { Id = 5, Name = "Bananas", Emoji = "🍌", Price = 1.49m, Quantity = 0 },
        new() { Id = 6, Name = "Strawberries", Emoji = "🍓", Price = 5.99m, Quantity = 0 },
        new() { Id = 7, Name = "Peaches", Emoji = "🍑", Price = 3.99m, Quantity = 0 },
        new() { Id = 8, Name = "Cherries", Emoji = "🍒", Price = 6.99m, Quantity = 0 },
    ];
}