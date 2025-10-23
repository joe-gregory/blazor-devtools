using System;
using System.Collections.Generic;
using System.Text;

namespace BlazorDeveloperTools.Tasks
{
    /// <summary>
    /// Helper class to represent a code block range
    /// </summary>
    internal class CodeBlockRange
    {
        public int Start { get; set; }
        public int End { get; set; }
        public string Type { get; set; } // "code", "functions", or "inline"
    }
}
