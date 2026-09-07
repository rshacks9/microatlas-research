using System;
using System.Globalization;
using System.Linq;
using System.Reflection;

namespace VatsimRadioRemote.VPilotPlugin
{
    /// <summary>
    /// vPilot's plugin SDK has changed member names and event-argument shapes between
    /// releases. Everything here reads the broker and its event arguments by name with
    /// fallbacks, so a renamed property degrades one field instead of breaking the plugin.
    /// </summary>
    internal static class Reflect
    {
        private const BindingFlags Flags =
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase | BindingFlags.FlattenHierarchy;

        public static object Property(object target, params string[] names)
        {
            if (target == null) return null;
            var type = target.GetType();
            foreach (var name in names)
            {
                try
                {
                    var p = type.GetProperty(name, Flags);
                    if (p != null && p.CanRead) return p.GetValue(target, null);
                    var f = type.GetField(name, Flags);
                    if (f != null) return f.GetValue(target);
                }
                catch { }
            }
            return null;
        }

        public static string Text(object target, params string[] names)
        {
            var v = Property(target, names);
            if (v == null) return null;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static double Number(object target, params string[] names)
        {
            var v = Property(target, names);
            if (v == null) return 0;

            // Some builds hand back a collection of frequencies rather than one value.
            var enumerable = v as System.Collections.IEnumerable;
            if (enumerable != null && !(v is string))
            {
                foreach (var item in enumerable)
                {
                    try { return Convert.ToDouble(item, CultureInfo.InvariantCulture); }
                    catch { }
                }
                return 0;
            }

            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
            catch { return 0; }
        }

        /// <summary>
        /// Subscribes to an event by name. Works with EventHandler&lt;T&gt; and with custom
        /// delegates, as long as the shape is void(object sender, TArgs args).
        /// </summary>
        public static bool Subscribe(object source, string eventName, string label, Action<string, object> callback)
        {
            if (source == null) return false;
            try
            {
                var evt = source.GetType().GetEvent(eventName, Flags);
                if (evt == null) return false;

                var invoke = evt.EventHandlerType.GetMethod("Invoke");
                if (invoke == null || invoke.ReturnType != typeof(void)) return false;

                var parameters = invoke.GetParameters();
                if (parameters.Length != 2) return false;

                var sink = new EventSink { Label = label, Callback = callback };
                var fire = typeof(EventSink)
                    .GetMethod("Fire", BindingFlags.Public | BindingFlags.Instance)
                    .MakeGenericMethod(parameters[1].ParameterType);

                var handler = Delegate.CreateDelegate(evt.EventHandlerType, sink, fire);
                evt.AddEventHandler(source, handler);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static bool Call(object target, string methodName, params object[] args)
        {
            if (target == null) return false;
            try
            {
                var method = target.GetType()
                    .GetMethods(Flags)
                    .FirstOrDefault(m => string.Equals(m.Name, methodName, StringComparison.OrdinalIgnoreCase)
                                         && m.GetParameters().Length == args.Length);
                if (method == null) return false;
                method.Invoke(target, args);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public class EventSink
        {
            public string Label;
            public Action<string, object> Callback;

            // Bound as the event handler; T is whatever the SDK's argument type happens to be.
            public void Fire<T>(object sender, T args)
            {
                try { Callback(Label, args); }
                catch { }
            }
        }
    }
}
